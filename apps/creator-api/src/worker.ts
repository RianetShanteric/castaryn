import postgres from "postgres";
import { readConfig } from "./config.js";
import { CreatorFeaturesService } from "./creator-features.js";
import { CreatorPlatformService } from "./creator-platform.js";
import {
  PostgresCreatorFeaturesRepository,
  PostgresCreatorPlatformRepository,
} from "./postgres-repository.js";
import {
  PostgresEventInboxRepository,
  PostgresTwitchBotRepository,
  PostgresYoutubeBotRepository,
} from "./postgres-streaming-operations.js";
import { decodeEncryptionKey, SecretBox } from "./secret-box.js";
import { TwitchBotService } from "./twitch-bot.js";
import { TwitchChatClient, TwitchChatRuntime } from "./twitch-chat.js";
import { TwitchClient } from "./twitch-client.js";
import { YoutubeClient } from "./youtube-client.js";
import { YoutubeBotService } from "./youtube-bot.js";
import {
  YoutubeChatClient,
  YoutubeChatPoller,
  YoutubeChatRuntime,
} from "./youtube-chat.js";
import { ExternalEventInbox, ExternalEventWorker } from "./event-inbox.js";
import { EventsService } from "./events.js";
import { PostgresEventsRepository } from "./postgres-events.js";

const config = readConfig();
const sql = postgres(config.databaseUrl, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl:
    config.environment === "production"
      ? { rejectUnauthorized: true }
      : false,
});

const migrationStatus = await sql<Array<{ count: number }>>`
  select count(*)::int as count from creator_schema_migrations
`;
if ((migrationStatus[0]?.count ?? 0) < 15) {
  await sql.end({ timeout: 5 });
  throw new Error("Creator database migrations are not applied");
}

const secretBox = new SecretBox(decodeEncryptionKey(config.encryptionKey));
const botService = new TwitchBotService(
  new PostgresTwitchBotRepository(sql),
  new TwitchClient({
    clientId: config.twitchClientId,
    clientSecret: config.twitchClientSecret,
    redirectUri: config.twitchBotRedirectUri,
  }),
  secretBox,
  config.twitchBotUserId,
);
const chatClient = new TwitchChatClient(
  {
    clientId: config.twitchClientId,
    clientSecret: config.twitchClientSecret,
    botUserId: config.twitchBotUserId,
    eventSubCallbackUrl: config.twitchEventSubCallbackUrl,
    eventSubSecret: config.twitchEventSubSecret,
  },
  botService,
);
const eventsService = new EventsService(new PostgresEventsRepository(sql));
const featuresService = new CreatorFeaturesService(
  new PostgresCreatorFeaturesRepository(sql),
);
const twitchRuntime = new TwitchChatRuntime(
  featuresService,
  chatClient,
  eventsService,
);

const platformService = new CreatorPlatformService(
  new PostgresCreatorPlatformRepository(sql),
  new TwitchClient({
    clientId: config.twitchClientId,
    clientSecret: config.twitchClientSecret,
    redirectUri: config.twitchRedirectUri,
  }),
  secretBox,
  undefined,
  undefined,
  config.youtube
    ? new YoutubeClient({
        clientId: config.youtube.clientId,
        clientSecret: config.youtube.clientSecret,
        redirectUri: config.youtube.redirectUri,
      })
    : undefined,
);
const youtubeBotService = config.youtube
  ? new YoutubeBotService(
      new PostgresYoutubeBotRepository(sql),
      new YoutubeClient({
        clientId: config.youtube.clientId,
        clientSecret: config.youtube.clientSecret,
        redirectUri: config.youtube.botRedirectUri,
      }),
      secretBox,
      config.youtube.botChannelId,
    )
  : undefined;
const youtubeChatClient = new YoutubeChatClient();
const youtubeRuntime =
  config.youtube && youtubeBotService
    ? new YoutubeChatRuntime(
        featuresService,
        youtubeChatClient,
        youtubeBotService,
        config.youtube.botChannelId,
        eventsService,
      )
    : undefined;
const eventInboxRepository = new PostgresEventInboxRepository(sql);
const eventInbox = new ExternalEventInbox(eventInboxRepository);
const youtubePoller =
  config.youtube && youtubeBotService
    ? new YoutubeChatPoller(
        youtubeChatClient,
        youtubeBotService,
        eventInbox,
        config.youtubePollIntervalMs,
      )
    : undefined;

const worker = new ExternalEventWorker(eventInboxRepository, {
  twitch: twitchRuntime,
  youtube: youtubeRuntime,
});

let stopping = false;
let lastDeliveryMaintenanceAt = 0;
let lastHeartbeatAt = 0;
let lastYoutubePollAt = 0;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await sql.end({ timeout: 5 });
  process.exitCode = 0;
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

async function pollYoutubeChannels() {
  if (!youtubePoller || !config.youtube) return;
  const credentials = await platformService.listYoutubeCredentials();
  for (const credential of credentials) {
    try {
      const accessToken =
        await platformService.ensureFreshYoutubeAccessToken(credential);
      await youtubePoller.pollChannel({
        connectionId: credential.connectionId,
        externalChannelId: credential.externalChannelId,
        creatorAccessToken: accessToken,
      });
    } catch (error) {
      console.error("YouTube chat poll failed for a channel", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

while (!stopping) {
  try {
    const now = Date.now();
    if (now - lastHeartbeatAt >= 5_000) {
      await sql`
        insert into creator_service_heartbeats (service_name, last_seen_at)
        values ('event_worker', now())
        on conflict (service_name) do update
        set last_seen_at = excluded.last_seen_at
      `;
      lastHeartbeatAt = now;
    }
    if (now - lastDeliveryMaintenanceAt >= 2_000) {
      const refunded = await eventsService.refundTimedOut();
      if (refunded > 0) {
        console.warn("Castaryn Events refunded undelivered effects", {
          refunded,
        });
      }
      lastDeliveryMaintenanceAt = now;
    }
    // The poller tracks its own per-channel cadence internally (and floors
    // it against YOUTUBE_POLL_INTERVAL_MS), so calling it every 5s here is
    // just how often we re-check whether any channel is actually due --
    // not how often YouTube's API gets hit.
    if (now - lastYoutubePollAt >= 5_000) {
      await pollYoutubeChannels();
      lastYoutubePollAt = now;
    }
    const processed = await worker.runOnce();
    await new Promise((resolve) => setTimeout(resolve, processed > 0 ? 25 : 500));
  } catch (error) {
    console.error("Creator event worker iteration failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
