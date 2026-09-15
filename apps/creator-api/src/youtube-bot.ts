import { createHash, randomBytes } from "node:crypto";
import type { SecretBox } from "./secret-box.js";
import type {
  YoutubeClient,
  YoutubeConnectionToken,
} from "./youtube-client.js";
import {
  isYoutubeAuthorizationFailure,
  YoutubeApiError,
} from "./youtube-client.js";

const requiredBotScopes = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

export type StoredYoutubeBotCredential = {
  externalUserId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  scopes: string[];
  expiresAt: Date;
  invalidatedAt: Date | null;
};

export interface YoutubeBotRepository {
  storeState(input: {
    stateHash: string;
    adminSubject: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeState(stateHash: string, now: Date): Promise<boolean>;
  upsertCredential(input: {
    externalUserId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    scopes: string[];
    expiresAt: Date;
  }): Promise<void>;
  findCredential(): Promise<StoredYoutubeBotCredential | null>;
  invalidateCredential(now: Date): Promise<void>;
}

function hashState(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function hasScopes(scopes: readonly string[], required: readonly string[]) {
  const granted = new Set(scopes);
  return required.every((scope) => granted.has(scope));
}

export class YoutubeBotService {
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly repository: YoutubeBotRepository,
    private readonly youtube: YoutubeClient,
    private readonly secrets: SecretBox,
    private readonly expectedBotChannelId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async beginAuthorization(adminSubject: string) {
    const state = randomBytes(32).toString("base64url");
    const now = this.now();
    await this.repository.storeState({
      stateHash: hashState(state),
      adminSubject,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });
    return this.youtube.buildAuthorizationUrl(state, requiredBotScopes);
  }

  async finishAuthorization(code: string, state: string) {
    const now = this.now();
    if (!(await this.repository.consumeState(hashState(state), now))) {
      throw new InvalidYoutubeBotOAuthStateError();
    }
    const token = await this.youtube.exchangeCode(code, now);
    await this.validateAndStore(token);
  }

  async status() {
    const credential = await this.repository.findCredential();
    return {
      connected: Boolean(credential && !credential.invalidatedAt),
      externalUserId: credential?.externalUserId ?? null,
      scopes: credential?.scopes ?? [],
      expiresAt: credential?.expiresAt.toISOString() ?? null,
    };
  }

  ensureReady(): Promise<string> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.ensureReadyInternal().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async ensureReadyInternal() {
    const credential = await this.repository.findCredential();
    if (!credential || credential.invalidatedAt) {
      throw new YoutubeBotAuthorizationRequiredError();
    }
    const now = this.now();
    try {
      let accessToken = this.secrets.decrypt(
        credential.encryptedAccessToken,
      );
      if (credential.expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
        const refreshed = await this.youtube.refreshToken(
          this.secrets.decrypt(credential.encryptedRefreshToken),
          now,
        );
        await this.validateAndStore(refreshed);
        accessToken = refreshed.accessToken;
      } else {
        const validation = await this.youtube.validate(accessToken);
        if (!hasScopes(validation.scopes, requiredBotScopes)) {
          throw new YoutubeBotAuthorizationRequiredError();
        }
      }
      return accessToken;
    } catch (error) {
      if (
        error instanceof YoutubeBotAuthorizationRequiredError ||
        isYoutubeAuthorizationFailure(error) ||
        (!(error instanceof YoutubeApiError) && !(error instanceof TypeError))
      ) {
        await this.repository.invalidateCredential(now);
      }
      throw error;
    }
  }

  private async validateAndStore(token: YoutubeConnectionToken) {
    const validation = await this.youtube.validate(token.accessToken);
    if (!hasScopes(validation.scopes, requiredBotScopes)) {
      throw new YoutubeBotAuthorizationRequiredError();
    }
    // Unlike Twitch's validate endpoint, Google's tokeninfo does not return
    // the channel id, so identity has to be confirmed with a second call.
    const channel = await this.youtube.getCurrentChannel(token.accessToken);
    if (channel.id !== this.expectedBotChannelId) {
      throw new YoutubeBotAuthorizationRequiredError();
    }
    await this.repository.upsertCredential({
      externalUserId: channel.id,
      encryptedAccessToken: this.secrets.encrypt(token.accessToken),
      encryptedRefreshToken: this.secrets.encrypt(token.refreshToken),
      scopes: validation.scopes,
      expiresAt: token.expiresAt,
    });
  }
}

export class InvalidYoutubeBotOAuthStateError extends Error {}
export class YoutubeBotAuthorizationRequiredError extends Error {}
