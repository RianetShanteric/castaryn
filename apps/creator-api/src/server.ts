import postgres from "postgres";
import { CreatorAccessService } from "./access-service.js";
import { buildCreatorApi } from "./app.js";
import { createOidcAuthenticator } from "./auth.js";
import { readConfig } from "./config.js";
import {
  PostgresCreatorPlatformRepository,
  PostgresCreatorFeaturesRepository,
  PostgresAdminRepository,
  PostgresSubscriptionRepository,
} from "./postgres-repository.js";
import { CreatorPlatformService } from "./creator-platform.js";
import { decodeEncryptionKey, SecretBox } from "./secret-box.js";
import { TwitchClient } from "./twitch-client.js";
import { CreatorFeaturesService } from "./creator-features.js";
import {
  TwitchChatClient,
  TwitchChatRuntime,
  TwitchEventSubVerifier,
} from "./twitch-chat.js";
import { AdminService } from "./admin-service.js";
import {
  PostgresEventInboxRepository,
  PostgresTwitchBotRepository,
} from "./postgres-streaming-operations.js";
import { TwitchBotService } from "./twitch-bot.js";
import { YoutubeClient } from "./youtube-client.js";
import { YoutubeBotService } from "./youtube-bot.js";
import { PostgresYoutubeBotRepository } from "./postgres-streaming-operations.js";
import { ExternalEventInbox } from "./event-inbox.js";
import { EventsService } from "./events.js";
import { PostgresEventsRepository } from "./postgres-events.js";
import {
  PostgresOperationsRepository,
  PostgresSiteAnalyticsRepository,
} from "./postgres-operations.js";
import { OperationsDashboardService } from "./operations-dashboard.js";
import { SiteAnalyticsService } from "./site-analytics.js";

const config = readConfig();
const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl:
    config.environment === "production"
      ? { rejectUnauthorized: true }
      : false,
});

let migrationCount: number;
try {
  const schemaStatus = await sql<
    Array<{ migration_count: number }>
  >`
    select count(*)::int as migration_count
    from creator_schema_migrations
  `;
  migrationCount = schemaStatus[0]?.migration_count ?? 0;
} catch {
  migrationCount = 0;
}
if (migrationCount < 15) {
  await sql.end({ timeout: 5 });
  throw new Error(
    "Creator database migrations are not applied; run the migration command first",
  );
}

const subscriptions = new PostgresSubscriptionRepository(sql);
const accessService = new CreatorAccessService(subscriptions);
const platformRepository = new PostgresCreatorPlatformRepository(sql);
const secretBox = new SecretBox(decodeEncryptionKey(config.encryptionKey));
const twitchBotService = new TwitchBotService(
  new PostgresTwitchBotRepository(sql),
  new TwitchClient({
    clientId: config.twitchClientId,
    clientSecret: config.twitchClientSecret,
    redirectUri: config.twitchBotRedirectUri,
  }),
  secretBox,
  config.twitchBotUserId,
);
const twitchChat = new TwitchChatClient({
  clientId: config.twitchClientId,
  clientSecret: config.twitchClientSecret,
  botUserId: config.twitchBotUserId,
  eventSubCallbackUrl: config.twitchEventSubCallbackUrl,
  eventSubSecret: config.twitchEventSubSecret,
}, twitchBotService);
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
const platformService = new CreatorPlatformService(
  platformRepository,
  new TwitchClient({
    clientId: config.twitchClientId,
    clientSecret: config.twitchClientSecret,
    redirectUri: config.twitchRedirectUri,
  }),
  secretBox,
  undefined,
  twitchChat,
  config.youtube
    ? new YoutubeClient({
        clientId: config.youtube.clientId,
        clientSecret: config.youtube.clientSecret,
        redirectUri: config.youtube.redirectUri,
      })
    : undefined,
);
const featuresService = new CreatorFeaturesService(
  new PostgresCreatorFeaturesRepository(sql),
);
const eventsService = new EventsService(new PostgresEventsRepository(sql));
const twitchChatRuntime = new TwitchChatRuntime(
  featuresService,
  twitchChat,
  eventsService,
);
const eventInboxRepository = new PostgresEventInboxRepository(sql);
const eventInbox = new ExternalEventInbox(eventInboxRepository);
const operationsService = new OperationsDashboardService(
  new PostgresOperationsRepository(sql),
  config.siteUrl,
);
const siteAnalyticsService = config.siteAnalyticsSecret
  ? new SiteAnalyticsService(
      new PostgresSiteAnalyticsRepository(sql),
      config.siteAnalyticsSecret,
    )
  : undefined;
const authenticate = createOidcAuthenticator({
  jwksUrl: config.authJwksUrl,
  issuer: config.authIssuer,
  audience: config.authAudience,
  requireVerifiedEmail: config.creatorRequireVerifiedEmail,
});
const authenticateAdmin = createOidcAuthenticator({
  jwksUrl: config.adminAuthJwksUrl,
  issuer: config.adminAuthIssuer,
  audience: config.adminAuthAudience,
  allowedSubjects: new Set(config.adminAllowedSubjects),
  requireMfa: config.adminRequireMfa,
});
const app = await buildCreatorApi({
  accessService,
  authenticate,
  platformService,
  featuresService,
  twitchChatRuntime,
  twitchEventSubVerifier: new TwitchEventSubVerifier(
    config.twitchEventSubSecret,
  ),
  adminService: new AdminService(new PostgresAdminRepository(sql)),
  authenticateAdmin,
  adminAllowedOrigin: config.adminAllowedOrigin,
  twitchBotService,
  youtubeBotService,
  youtubeConfigured: Boolean(config.youtube),
  eventInbox,
  eventsService,
  operationsService,
  siteAnalyticsService,
  siteAllowedOrigin: config.siteUrl.origin,
  telegram: config.telegram ?? undefined,
  logger: true,
  trustProxy: config.trustProxyHops || undefined,
});

app.get("/readyz", async (_request, reply) => {
  try {
    await sql`select 1`;
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "unavailable" });
  }
});

let maintainingTwitchConnections = false;
const maintainTwitchConnections = async () => {
  if (maintainingTwitchConnections) return;
  maintainingTwitchConnections = true;
  try {
    await platformService.maintainTwitchConnections();
  } catch (error) {
    app.log.error(
      {
        errorName:
          error instanceof Error ? error.name : "UnknownError",
      },
      "Twitch connection maintenance failed",
    );
  } finally {
    maintainingTwitchConnections = false;
  }
};
await maintainTwitchConnections();
const twitchMaintenanceTimer = setInterval(
  () => void maintainTwitchConnections(),
  60 * 60 * 1000,
);

let maintainingYoutubeConnections = false;
const maintainYoutubeConnections = async () => {
  if (maintainingYoutubeConnections) return;
  maintainingYoutubeConnections = true;
  try {
    await platformService.maintainYoutubeConnections();
  } catch (error) {
    app.log.error(
      {
        errorName:
          error instanceof Error ? error.name : "UnknownError",
      },
      "YouTube connection maintenance failed",
    );
  } finally {
    maintainingYoutubeConnections = false;
  }
};
await maintainYoutubeConnections();
// Google access tokens commonly last only ~1 hour (vs. Twitch's ~4), so
// this runs more often than the Twitch sweep -- mainly to catch revoked
// grants promptly; the poller in worker.ts also refreshes tokens
// just-in-time, so this isn't the only thing standing between a channel
// and an expired token.
const youtubeMaintenanceTimer = setInterval(
  () => void maintainYoutubeConnections(),
  15 * 60 * 1000,
);

const shutdown = async () => {
  clearInterval(twitchMaintenanceTimer);
  clearInterval(youtubeMaintenanceTimer);
  await app.close();
  await sql.end({ timeout: 5 });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
