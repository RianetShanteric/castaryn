import { z } from "zod";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.array(z.string()).default([]),
  token_type: z.string(),
});

const UserResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        login: z.string().min(1),
        display_name: z.string().min(1),
      }),
    )
    .min(1),
});

const ValidationSchema = z.object({
  client_id: z.string().min(1),
  user_id: z.string().min(1),
  login: z.string().min(1),
  scopes: z.array(z.string()),
  expires_in: z.number().int().nonnegative(),
});

export type TwitchConnectionToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

export type TwitchChannel = {
  id: string;
  login: string;
  displayName: string;
};

export type TwitchClientSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class TwitchClient {
  constructor(
    private readonly settings: TwitchClientSettings,
    private readonly request: typeof fetch = fetch,
  ) {}

  buildAuthorizationUrl(
    state: string,
    scopes: readonly string[] = ["channel:bot"],
  ) {
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", this.settings.clientId);
    url.searchParams.set("redirect_uri", this.settings.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("force_verify", "true");
    url.searchParams.set("scope", scopes.join(" "));
    return url.toString();
  }

  async exchangeCode(code: string, now = new Date()) {
    const body = new URLSearchParams({
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: this.settings.redirectUri,
    });
    const response = await this.request(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!response.ok) {
      throw new TwitchApiError("token_exchange", response.status);
    }
    const token = TokenResponseSchema.parse(await response.json());
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000),
      scopes: token.scope,
    } satisfies TwitchConnectionToken;
  }

  async refreshToken(refreshToken: string, now = new Date()) {
    const body = new URLSearchParams({
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await this.request(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!response.ok) {
      throw new TwitchApiError("token_refresh", response.status);
    }
    const token = TokenResponseSchema.parse(await response.json());
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000),
      scopes: token.scope,
    } satisfies TwitchConnectionToken;
  }

  async validate(accessToken: string) {
    const response = await this.request(
      "https://id.twitch.tv/oauth2/validate",
      {
        headers: { Authorization: `OAuth ${accessToken}` },
      },
    );
    if (!response.ok) {
      throw new TwitchApiError("token_validation", response.status);
    }
    const validation = ValidationSchema.parse(await response.json());
    if (validation.client_id !== this.settings.clientId) {
      throw new Error("Twitch token belongs to another client");
    }
    return validation;
  }

  async getCurrentChannel(accessToken: string): Promise<TwitchChannel> {
    const response = await this.request("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.settings.clientId,
      },
    });
    if (!response.ok) {
      throw new TwitchApiError("user_lookup", response.status);
    }
    const user = UserResponseSchema.parse(await response.json()).data[0]!;
    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
    };
  }
}

export class TwitchApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`Twitch ${operation} failed (${status})`);
  }
}

export function isTwitchAuthorizationFailure(error: unknown) {
  return (
    error instanceof TwitchApiError &&
    [400, 401, 403].includes(error.status)
  );
}
