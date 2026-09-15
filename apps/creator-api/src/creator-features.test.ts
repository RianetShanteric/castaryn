import { describe, expect, it, vi } from "vitest";
import {
  CreatorFeaturesService,
  renderTemplate,
  type CreatorFeaturesRepository,
  type PublicStreamState,
} from "./creator-features.js";

const state: PublicStreamState = {
  activity: "Perfect World PvE",
  pack: "Пачка 2",
  dungeon: "Храм стихий",
  nextDungeon: "Остров Рыцарей",
  dailyQuest: "Доспехи",
  inventoryChests: 70,
  timerSeconds: 754,
  packsDone: 1,
  packsTotal: 4,
  dungeonsDone: 5,
  dungeonsTotal: 16,
  chests: 100,
  farmTimeSeconds: 3605,
  server: "Феникс",
  player: "Streamer",
};

function repository(
  overrides: Partial<CreatorFeaturesRepository> = {},
): CreatorFeaturesRepository {
  return {
    listAccessibleCreators: async () => [],
    resolveRole: async () => "owner",
    findActiveConnectionId: async () => "connection-1",
    listCommands: async () => [],
    findCommandForChannel: async () => null,
    findLatestOverlayState: async () => state,
    acquireCommandCooldown: async () => true,
    createCommand: vi.fn(),
    updateCommand: vi.fn(),
    deleteCommand: vi.fn(),
    upsertOverlayConfiguration: vi.fn(),
    hasOverlayConfiguration: async () => false,
    findOverlayConfiguration: async () => null,
    updateOverlayState: vi.fn(),
    findOverlayByTokenHash: vi.fn(),
    ...overrides,
  };
}

describe("Creator features", () => {
  it("renders the supported Castaryn variables from current state", () => {
    expect(
      renderTemplate(
        "{activity}: {progress}. Сундуки: {reward_total}. Время: {time}",
        state,
      ),
    ).toBe(
      "Perfect World PvE: Пачки 1/4, данжи 5/16. Сундуки: 100. Время: 01:00:05",
    );
  });

  it("enforces command audience before rendering a response", async () => {
    const service = new CreatorFeaturesService(
      repository({
        findCommandForChannel: async () => ({
          id: "command-1",
          creatorIdentityId: "creator-1",
          connectionId: "connection-1",
          provider: "twitch",
          trigger: "!фарм",
          responseTemplate: "{progress}",
          accessLevel: "moderators",
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      }),
    );

    await expect(
      service.respondToChatCommand({
        provider: "twitch",
        externalChannelId: "123",
        chatterUserId: "viewer",
        chatterIsModerator: false,
        text: "!фарм",
      }),
    ).resolves.toBeNull();
    await expect(
      service.respondToChatCommand({
        provider: "twitch",
        externalChannelId: "123",
        chatterUserId: "moderator",
        chatterIsModerator: true,
        text: "!фарм",
      }),
    ).resolves.toBe("Пачки 1/4, данжи 5/16");
  });
});
