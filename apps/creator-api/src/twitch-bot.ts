import { createHash, randomBytes } from "node:crypto";
import type { SecretBox } from "./secret-box.js";
import type {
  TwitchClient,
  TwitchConnectionToken,
} from "./twitch-client.js";
import {
  isTwitchAuthorizationFailure,
  TwitchApiError,
} from "./twitch-client.js";

const requiredBotScopes = [
  "user:bot",
  "user:read:chat",
  "user:write:chat",
] as const;

export type StoredBotCredential = {
  externalUserId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  scopes: string[];
  expiresAt: Date;
  invalidatedAt: Date | null;
};

export interface TwitchBotRepository {
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
  findCredential(): Promise<StoredBotCredential | null>;
  invalidateCredential(now: Date): Promise<void>;
}

function hashState(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function hasScopes(scopes: readonly string[], required: readonly string[]) {
  const granted = new Set(scopes);
  return required.every((scope) => granted.has(scope));
}

export class TwitchBotService {
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly repository: TwitchBotRepository,
    private readonly twitch: TwitchClient,
    private readonly secrets: SecretBox,
    private readonly expectedBotUserId: string,
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
    return this.twitch.buildAuthorizationUrl(state, requiredBotScopes);
  }

  async finishAuthorization(code: string, state: string) {
    const now = this.now();
    if (!(await this.repository.consumeState(hashState(state), now))) {
      throw new InvalidTwitchBotOAuthStateError();
    }
    const token = await this.twitch.exchangeCode(code, now);
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
      throw new TwitchBotAuthorizationRequiredError();
    }
    const now = this.now();
    try {
      let accessToken = this.secrets.decrypt(
        credential.encryptedAccessToken,
      );
      if (credential.expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
        const refreshed = await this.twitch.refreshToken(
          this.secrets.decrypt(credential.encryptedRefreshToken),
          now,
        );
        await this.validateAndStore(refreshed);
        accessToken = refreshed.accessToken;
      } else {
        const validation = await this.twitch.validate(accessToken);
        this.assertBotGrant(validation.user_id, validation.scopes);
      }
      return accessToken;
    } catch (error) {
      if (
        error instanceof TwitchBotAuthorizationRequiredError ||
        isTwitchAuthorizationFailure(error) ||
        (!(error instanceof TwitchApiError) && !(error instanceof TypeError))
      ) {
        await this.repository.invalidateCredential(now);
      }
      throw error;
    }
  }

  private async validateAndStore(token: TwitchConnectionToken) {
    const validation = await this.twitch.validate(token.accessToken);
    this.assertBotGrant(validation.user_id, validation.scopes);
    await this.repository.upsertCredential({
      externalUserId: validation.user_id,
      encryptedAccessToken: this.secrets.encrypt(token.accessToken),
      encryptedRefreshToken: this.secrets.encrypt(token.refreshToken),
      scopes: validation.scopes,
      expiresAt: token.expiresAt,
    });
  }

  private assertBotGrant(userId: string, scopes: readonly string[]) {
    if (
      userId !== this.expectedBotUserId ||
      !hasScopes(scopes, requiredBotScopes)
    ) {
      throw new TwitchBotAuthorizationRequiredError();
    }
  }
}

export class InvalidTwitchBotOAuthStateError extends Error {}
export class TwitchBotAuthorizationRequiredError extends Error {}
