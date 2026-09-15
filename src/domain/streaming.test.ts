import { describe, expect, it } from "vitest";
import {
  getStreamingIntegration,
  streamingIntegrations,
} from "./streaming";

describe("streaming integration registry", () => {
  it("keeps adapter identifiers unique", () => {
    const ids = streamingIntegrations.map((integration) => integration.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exposes MVP adapters without coupling Player data to them", () => {
    expect(getStreamingIntegration("twitch")?.creatorFeatures).toContain(
      "chat_commands",
    );
    expect(getStreamingIntegration("obs")?.creatorFeatures).toContain(
      "overlay",
    );
    expect(getStreamingIntegration("unknown")).toBeUndefined();
  });
});
