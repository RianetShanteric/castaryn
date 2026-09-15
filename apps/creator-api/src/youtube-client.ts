import { z } from "zod";

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  // Google only returns refresh_token on the very first consent (or when
  // prompt=consent forces a fresh one) -- refreshes reuse the original.
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().default(""),
  token_type: z.string(),
});

const TokenInfoSchema = z.object({
  aud: z.string().min(1),
  scope: z.string().default(""),
  expires_in: z.coerce.number().int().nonnegative(),
});

const ChannelResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z.object({
          title: z.string().min(1),
          customUrl: z.string().optional(),
        }),
      }),
    )
    .min(1),
});

export type YoutubeConnectionToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

export type YoutubeChannel = {
  id: string;
  login: string;
  displayName: string;
};

export type YoutubeClientSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class YoutubeClient {
  constructor(
    private readonly settings: YoutubeClientSettings,
    private readonly request: typeof fetch = fetch,
  ) {}

  buildAuthorizationUrl(
    state: string,
    scopes: readonly string[] = [
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
  ) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.settings.clientId);
    url.searchParams.set("redirect_uri", this.settings.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    // access_type=offline + prompt=consent are both required to reliably
    // get a refresh_token back -- Google otherwise only issues one on the
    // account's very first authorization of this client.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
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
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new YoutubeApiError("token_exchange", response.status);
    }
    const token = TokenResponseSchema.parse(await response.json());
    if (!token.refresh_token) {
      throw new Error(
        "Google did not return a refresh token; the user must re-consent",
      );
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000),
      scopes: token.scope.split(" ").filter(Boolean),
    } satisfies YoutubeConnectionToken;
  }

  async refreshToken(
    refreshToken: string,
    now = new Date(),
  ): Promise<YoutubeConnectionToken> {
    const body = new URLSearchParams({
      client_id: this.settings.clientId,
      client_secret: this.settings.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const response = await this.request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new YoutubeApiError("token_refresh", response.status);
    }
    const token = TokenResponseSchema.parse(await response.json());
    return {
      accessToken: token.access_token,
      // Reuse the caller's refresh token when Google doesn't rotate it.
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000),
      scopes: token.scope.split(" ").filter(Boolean),
    };
  }

  async validate(accessToken: string) {
    const response = await this.request(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!response.ok) {
      throw new YoutubeApiError("token_validation", response.status);
    }
    const info = TokenInfoSchema.parse(await response.json());
    if (info.aud !== this.settings.clientId) {
      throw new Error("YouTube token belongs to another client");
    }
    return {
      scopes: info.scope.split(" ").filter(Boolean),
      expiresIn: info.expires_in,
    };
  }

  async getCurrentChannel(accessToken: string): Promise<YoutubeChannel> {
    const response = await this.request(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      throw new YoutubeApiError("channel_lookup", response.status);
    }
    const channel = ChannelResponseSchema.parse(await response.json())
      .items[0]!;
    return {
      id: channel.id,
      login: channel.snippet.customUrl ?? channel.id,
      displayName: channel.snippet.title,
    };
  }
}

export class YoutubeApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`YouTube ${operation} failed (${status})`);
  }
}

export function isYoutubeAuthorizationFailure(error: unknown) {
  return (
    error instanceof YoutubeApiError &&
    [400, 401, 403].includes(error.status)
  );
}
