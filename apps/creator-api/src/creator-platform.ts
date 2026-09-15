import { createHash, randomBytes } from "node:crypto";
import type { SecretBox } from "./secret-box.js";
import type {
  TwitchChannel,
  TwitchClient,
  TwitchConnectionToken,
} from "./twitch-client.js";
import {
  isTwitchAuthorizationFailure,
  TwitchApiError,
} from "./twitch-client.js";
import type {
  YoutubeChannel,
  YoutubeClient,
  YoutubeConnectionToken,
} from "./youtube-client.js";
import {
  isYoutubeAuthorizationFailure,
  YoutubeApiError,
} from "./youtube-client.js";
import type { StreamingChannelProvisioner } from "./streaming-provider.js";

export type OAuthState = {
  userId: string;
  provider: string;
  expiresAt: Date;
};

export type ConnectedChannel = TwitchChannel & {
  connectionId: string;
  connectedAt: Date;
};

export type ConnectedYoutubeChannel = YoutubeChannel & {
  connectionId: string;
  connectedAt: Date;
};

export type StoredTwitchCredential = {
  connectionId: string;
  externalChannelId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAt: Date;
};

export type StoredYoutubeCredential = {
  connectionId: string;
  externalChannelId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAt: Date;
};

export interface CreatorPlatformRepository {
  ensureAccount(input: {
    issuer: string;
    subject: string;
    email: string;
    emailVerified: boolean;
  }): Promise<string>;
  storeOAuthState(input: {
    stateHash: string;
    userId: string;
    provider: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeOAuthState(
    stateHash: string,
    now: Date,
  ): Promise<OAuthState | null>;
  upsertTwitchConnection(input: {
    userId: string;
    channel: TwitchChannel;
    token: TwitchConnectionToken;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
  }): Promise<ConnectedChannel>;
  findTwitchConnection(userId: string): Promise<ConnectedChannel | null>;
  disconnectTwitch(userId: string, now: Date): Promise<void>;
  listTwitchCredentials(): Promise<StoredTwitchCredential[]>;
  updateTwitchCredential(
    connectionId: string,
    input: {
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      expiresAt: Date;
      scopes: string[];
    },
  ): Promise<void>;
  invalidateTwitchConnection(
    connectionId: string,
    now: Date,
  ): Promise<void>;
  updateTwitchEventSubStatus(
    connectionId: string,
    status: "pending" | "ready" | "failed",
    checkedAt: Date,
  ): Promise<void>;
  confirmTwitchEventSub(
    externalChannelId: string,
    confirmedAt: Date,
  ): Promise<void>;
  upsertYoutubeConnection(input: {
    userId: string;
    channel: YoutubeChannel;
    token: YoutubeConnectionToken;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
  }): Promise<ConnectedYoutubeChannel>;
  findYoutubeConnection(
    userId: string,
  ): Promise<ConnectedYoutubeChannel | null>;
  disconnectYoutube(userId: string, now: Date): Promise<void>;
  listYoutubeCredentials(): Promise<StoredYoutubeCredential[]>;
  updateYoutubeCredential(
    connectionId: string,
    input: {
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      expiresAt: Date;
      scopes: string[];
    },
  ): Promise<void>;
  invalidateYoutubeConnection(
    connectionId: string,
    now: Date,
  ): Promise<void>;
}

function hashState(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

const youtubeConnectScope =
  "https://www.googleapis.com/auth/youtube.readonly";

export class CreatorPlatformService {
  constructor(
    private readonly repository: CreatorPlatformRepository,
    private readonly twitch: TwitchClient,
    private readonly secrets: SecretBox,
    private readonly now: () => Date = () => new Date(),
    private readonly channelProvisioner?: StreamingChannelProvisioner,
    private readonly youtube?: YoutubeClient,
  ) {}

  ensureAccount(input: {
    issuer: string;
    subject: string;
    email: string;
    emailVerified: boolean;
  }) {
    return this.repository.ensureAccount(input);
  }

  async beginTwitchConnection(userId: string) {
    const state = randomBytes(32).toString("base64url");
    const now = this.now();
    await this.repository.storeOAuthState({
      stateHash: hashState(state),
      userId,
      provider: "twitch",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });
    return this.twitch.buildAuthorizationUrl(state);
  }

  async finishTwitchConnection(code: string, state: string) {
    const now = this.now();
    const stored = await this.repository.consumeOAuthState(
      hashState(state),
      now,
    );
    if (!stored || stored.provider !== "twitch") {
      throw new InvalidOAuthStateError();
    }

    const token = await this.twitch.exchangeCode(code, now);
    const validation = await this.twitch.validate(token.accessToken);
    if (!validation.scopes.includes("channel:bot")) {
      throw new Error("Twitch did not grant the required channel:bot scope");
    }
    const channel = await this.twitch.getCurrentChannel(token.accessToken);
    if (channel.id !== validation.user_id) {
      throw new Error("Twitch identity validation failed");
    }
    const connection = await this.repository.upsertTwitchConnection({
      userId: stored.userId,
      channel,
      token,
      encryptedAccessToken: this.secrets.encrypt(token.accessToken),
      encryptedRefreshToken: this.secrets.encrypt(token.refreshToken),
    });
    if (this.channelProvisioner?.provider === "twitch") {
      try {
        const status =
          await this.channelProvisioner.provisionChannel(channel.id);
        await this.repository.updateTwitchEventSubStatus(
          connection.connectionId,
          status,
          now,
        );
      } catch (error) {
        await this.repository.updateTwitchEventSubStatus(
          connection.connectionId,
          "failed",
          now,
        );
        throw error;
      }
    }
    return { connection };
  }

  getTwitchConnection(userId: string) {
    return this.repository.findTwitchConnection(userId);
  }

  disconnectTwitch(userId: string) {
    return this.repository.disconnectTwitch(userId, this.now());
  }

  confirmTwitchEventSub(externalChannelId: string) {
    return this.repository.confirmTwitchEventSub(
      externalChannelId,
      this.now(),
    );
  }

  private requireYoutube() {
    if (!this.youtube) {
      throw new Error("YouTube integration is not configured");
    }
    return this.youtube;
  }

  async beginYoutubeConnection(userId: string) {
    const youtube = this.requireYoutube();
    const state = randomBytes(32).toString("base64url");
    const now = this.now();
    await this.repository.storeOAuthState({
      stateHash: hashState(state),
      userId,
      provider: "youtube",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });
    return youtube.buildAuthorizationUrl(state);
  }

  async finishYoutubeConnection(code: string, state: string) {
    const youtube = this.requireYoutube();
    const now = this.now();
    const stored = await this.repository.consumeOAuthState(
      hashState(state),
      now,
    );
    if (!stored || stored.provider !== "youtube") {
      throw new InvalidOAuthStateError();
    }

    const token = await youtube.exchangeCode(code, now);
    const validation = await youtube.validate(token.accessToken);
    if (!validation.scopes.includes(youtubeConnectScope)) {
      throw new Error(
        "YouTube did not grant the required youtube.readonly scope",
      );
    }
    // Google's tokeninfo does not return the channel id, unlike Twitch's
    // validate endpoint, so identity comes from a separate Data API call.
    const channel = await youtube.getCurrentChannel(token.accessToken);
    const connection = await this.repository.upsertYoutubeConnection({
      userId: stored.userId,
      channel,
      token,
      encryptedAccessToken: this.secrets.encrypt(token.accessToken),
      encryptedRefreshToken: this.secrets.encrypt(token.refreshToken),
    });
    return { connection };
  }

  getYoutubeConnection(userId: string) {
    return this.repository.findYoutubeConnection(userId);
  }

  disconnectYoutube(userId: string) {
    return this.repository.disconnectYoutube(userId, this.now());
  }

  // Refreshes and persists the credential when it's close to expiry, or
  // just decrypts the still-good access token otherwise. Shared by the
  // hourly maintenance sweep below and by the YouTube chat poller (worker.ts)
  // -- unlike Twitch's ~4 hour tokens, Google's access tokens commonly live
  // only ~1 hour, so relying on the hourly sweep alone risks a channel's
  // token expiring between ticks; the poller calls this on every cycle
  // instead of waiting for maintenance to catch up.
  async ensureFreshYoutubeAccessToken(
    credential: StoredYoutubeCredential,
  ): Promise<string> {
    const youtube = this.requireYoutube();
    const now = this.now();
    if (credential.expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
      return this.secrets.decrypt(credential.encryptedAccessToken);
    }
    const refreshed = await youtube.refreshToken(
      this.secrets.decrypt(credential.encryptedRefreshToken),
      now,
    );
    await this.repository.updateYoutubeCredential(credential.connectionId, {
      encryptedAccessToken: this.secrets.encrypt(refreshed.accessToken),
      encryptedRefreshToken: this.secrets.encrypt(refreshed.refreshToken),
      expiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes,
    });
    return refreshed.accessToken;
  }

  listYoutubeCredentials() {
    return this.repository.listYoutubeCredentials();
  }

  async maintainYoutubeConnections() {
    if (!this.youtube) return;
    const youtube = this.youtube;
    const now = this.now();
    const credentials = await this.repository.listYoutubeCredentials();
    for (const credential of credentials) {
      try {
        const accessToken = await this.ensureFreshYoutubeAccessToken(
          credential,
        );
        const validation = await youtube.validate(accessToken);
        if (!validation.scopes.includes(youtubeConnectScope)) {
          throw new InvalidYoutubeChannelGrantError();
        }
      } catch (error) {
        if (
          error instanceof InvalidYoutubeChannelGrantError ||
          isYoutubeAuthorizationFailure(error) ||
          (!(error instanceof YoutubeApiError) && !(error instanceof TypeError))
        ) {
          await this.repository.invalidateYoutubeConnection(
            credential.connectionId,
            now,
          );
        }
      }
    }
  }

  async maintainTwitchConnections() {
    const now = this.now();
    const credentials = await this.repository.listTwitchCredentials();
    for (const credential of credentials) {
      try {
        let accessToken = this.secrets.decrypt(
          credential.encryptedAccessToken,
        );
        if (credential.expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
          const refreshed = await this.twitch.refreshToken(
            this.secrets.decrypt(credential.encryptedRefreshToken),
            now,
          );
          accessToken = refreshed.accessToken;
          await this.repository.updateTwitchCredential(
            credential.connectionId,
            {
              encryptedAccessToken: this.secrets.encrypt(
                refreshed.accessToken,
              ),
              encryptedRefreshToken: this.secrets.encrypt(
                refreshed.refreshToken,
              ),
              expiresAt: refreshed.expiresAt,
              scopes: refreshed.scopes,
            },
          );
        }
        const validation = await this.twitch.validate(accessToken);
        if (
          validation.user_id !== credential.externalChannelId ||
          !validation.scopes.includes("channel:bot")
        ) {
          throw new InvalidTwitchChannelGrantError();
        }
        if (this.channelProvisioner?.provider === "twitch") {
          try {
            const status =
              await this.channelProvisioner.provisionChannel(
                credential.externalChannelId,
              );
            await this.repository.updateTwitchEventSubStatus(
              credential.connectionId,
              status,
              now,
            );
          } catch {
            await this.repository.updateTwitchEventSubStatus(
              credential.connectionId,
              "failed",
              now,
            );
          }
        }
      } catch (error) {
        if (
          error instanceof InvalidTwitchChannelGrantError ||
          isTwitchAuthorizationFailure(error) ||
          (!(error instanceof TwitchApiError) && !(error instanceof TypeError))
        ) {
          await this.repository.invalidateTwitchConnection(
            credential.connectionId,
            now,
          );
        }
      }
    }
  }
}

export class CreatorAccessRequiredError extends Error {}
export class InvalidOAuthStateError extends Error {}
class InvalidTwitchChannelGrantError extends Error {}
class InvalidYoutubeChannelGrantError extends Error {}
