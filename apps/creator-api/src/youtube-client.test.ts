import { describe, expect, it, vi } from "vitest";
import { YoutubeClient } from "./youtube-client.js";

describe("YoutubeClient", () => {
  it("requests offline access and forces consent so a refresh token comes back", () => {
    const client = new YoutubeClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "https://creator.example/youtube/callback",
    });
    const url = new URL(client.buildAuthorizationUrl("secure-state"));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("secure-state");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("fails the exchange when Google withholds the refresh token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/youtube.readonly",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    const client = new YoutubeClient(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/youtube/callback",
      },
      request,
    );

    await expect(client.exchangeCode("code")).rejects.toThrow(
      "did not return a refresh token",
    );
  });

  it("keeps the caller's refresh token when a refresh response omits a new one", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/youtube.readonly",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    const client = new YoutubeClient(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/youtube/callback",
      },
      request,
    );

    const refreshed = await client.refreshToken("original-refresh-token");

    expect(refreshed.accessToken).toBe("new-access");
    expect(refreshed.refreshToken).toBe("original-refresh-token");
  });

  it("rejects a token issued for another Google client", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          aud: "another-client",
          scope: "https://www.googleapis.com/auth/youtube.readonly",
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );
    const client = new YoutubeClient(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/youtube/callback",
      },
      request,
    );

    await expect(client.validate("token")).rejects.toThrow(
      "another client",
    );
  });

  it("maps the current channel from the Data API response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "UCabcdefghijklmnopqrstuv",
              snippet: { title: "Streamer", customUrl: "@streamer" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new YoutubeClient(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/youtube/callback",
      },
      request,
    );

    await expect(client.getCurrentChannel("token")).resolves.toEqual({
      id: "UCabcdefghijklmnopqrstuv",
      login: "@streamer",
      displayName: "Streamer",
    });
  });
});
