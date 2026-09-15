import { describe, expect, it, vi } from "vitest";
import { TwitchClient } from "./twitch-client.js";

describe("TwitchClient", () => {
  it("uses the server-side authorization code flow with minimal scope", () => {
    const client = new TwitchClient({
      clientId: "client-id",
      clientSecret: "secret",
      redirectUri: "https://creator.example/callback",
    });
    const url = new URL(client.buildAuthorizationUrl("secure-state"));

    expect(url.origin).toBe("https://id.twitch.tv");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("channel:bot");
    expect(url.searchParams.get("state")).toBe("secure-state");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("rejects a token issued for another Twitch application", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          client_id: "another-client",
          user_id: "123",
          login: "streamer",
          scopes: ["channel:bot"],
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );
    const client = new TwitchClient(
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://creator.example/callback",
      },
      request,
    );

    await expect(client.validate("token")).rejects.toThrow(
      "another client",
    );
  });
});
