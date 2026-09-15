import { describe, expect, it, vi } from "vitest";
import {
  EventsService,
  eventDefinitions,
  type EventsRepository,
} from "./events.js";

function repository(
  overrides: Partial<EventsRepository> = {},
): EventsRepository {
  return {
    resolveRole: vi.fn().mockResolvedValue("owner"),
    rememberModeratorBadge: vi.fn().mockResolvedValue(undefined),
    getOrCreateProfileForCreator: vi.fn().mockResolvedValue({
      id: "profile",
      creatorIdentityId: "creator",
      connectionId: "connection",
      name: "Channel Events",
      currencyName: "Булочки",
      isEnabled: true,
      controlRevision: "0",
    }),
    getOrCreateProfileForChannel: vi.fn().mockResolvedValue({
      id: "profile",
      creatorIdentityId: "creator",
      connectionId: "connection",
      name: "Channel Events",
      currencyName: "Булочки",
      isEnabled: true,
      controlRevision: "0",
    }),
    updateProfile: vi.fn(),
    stopEffects: vi.fn().mockResolvedValue({ controlRevision: "1" }),
    listEventConfigurations: vi
      .fn()
      .mockResolvedValue(
        eventDefinitions.map((event) => ({
          ...event,
          enabled: true,
          showInCatalog: true,
        })),
      ),
    updateEventConfiguration: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({
      viewerKey: "viewer",
      displayName: "Viewer",
      balance: 2_000,
    }),
    adjustBalance: vi.fn().mockResolvedValue({
      viewerKey: "viewer",
      displayName: "Viewer",
      balance: 2_500,
    }),
    resolveViewer: vi.fn().mockResolvedValue({
      status: "found",
      viewerKey: "somebody",
      displayName: "Somebody",
    }),
    listBalances: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    purchase: vi.fn().mockResolvedValue({
      status: "purchased",
      balance: 1_000,
      effect: {
        sequence: "1",
        id: "00000000-0000-4000-8000-000000000001",
        eventId: "screamer",
        viewerName: "Viewer",
        effect: eventDefinitions[0]!.effect,
        createdAt: "2026-07-24T20:00:00.000Z",
      },
    }),
    listEffects: vi.fn().mockResolvedValue([]),
    listPublicEffects: vi.fn().mockResolvedValue([]),
    latestSequence: vi.fn().mockResolvedValue("0"),
    latestPublicSequence: vi.fn().mockResolvedValue("0"),
    heartbeat: vi.fn().mockResolvedValue({ controlRevision: "0" }),
    heartbeatPublic: vi.fn().mockResolvedValue({ controlRevision: "0" }),
    acknowledge: vi.fn().mockResolvedValue(true),
    acknowledgePublic: vi.fn().mockResolvedValue(true),
    refundTimedOut: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

const chat = {
  provider: "twitch",
  externalChannelId: "channel",
  viewerExternalId: "123",
  viewerKey: "viewer",
  viewerName: "Viewer",
  viewerIsModerator: false,
};

describe("EventsService", () => {
  it("returns the persistent channel balance", async () => {
    const service = new EventsService(repository());

    await expect(
      service.respondToChat({ ...chat, text: "!баланс" }),
    ).resolves.toBe("Ваш баланс: 2000 булочки");
  });

  it("purchases a built-in event through the universal engine", async () => {
    const repo = repository();
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({ ...chat, text: "!скример" }),
    ).resolves.toBe("Viewer активировал 👻 Скример");
    expect(repo.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "profile",
        viewerKey: "viewer",
        definition: expect.objectContaining({
          id: "screamer",
          price: 1_000,
        }),
      }),
    );
  });

  it("selects screamer image and sound independently for both consumers", async () => {
    const repo = repository();
    const values = [2, 5];
    const service = new EventsService(
      repo,
      () => new Date("2026-07-25T12:00:00.000Z"),
      () => values.shift()!,
    );

    await service.respondToChat({ ...chat, text: "!скример" });

    expect(repo.purchase).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          effect: expect.objectContaining({
            parameters: expect.objectContaining({
              visualAsset: 2,
              audioAsset: 5,
            }),
          }),
        }),
      }),
    );
  });

  it("does not let viewers adjust another balance", async () => {
    const repo = repository();
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({
        ...chat,
        text: "!начислить somebody 500",
      }),
    ).resolves.toBeNull();
    expect(repo.adjustBalance).not.toHaveBeenCalled();
  });

  it("lets a Twitch moderator grant channel currency", async () => {
    const repo = repository({
      adjustBalance: vi.fn().mockResolvedValue({
        viewerKey: "somebody",
        displayName: "Somebody",
        balance: 2_500,
      }),
    });
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({
        ...chat,
        viewerIsModerator: true,
        text: "!начислить @somebody 500",
      }),
    ).resolves.toBe("Somebody получил 500 булочки");
    expect(repo.resolveViewer).toHaveBeenCalledWith("profile", "somebody");
    expect(repo.adjustBalance).toHaveBeenCalledWith(
      "profile",
      "somebody",
      null,
      null,
      500,
    );
  });

  it("still grants to a not-yet-seen Twitch-shaped login (pre-chat grant)", async () => {
    const repo = repository({
      resolveViewer: vi.fn().mockResolvedValue({ status: "not_found" }),
      adjustBalance: vi.fn().mockResolvedValue({
        viewerKey: "ghost",
        displayName: "ghost",
        balance: 500,
      }),
    });
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({
        ...chat,
        viewerIsModerator: true,
        text: "!начислить @ghost 500",
      }),
    ).resolves.toBe("ghost получил 500 булочки");
    expect(repo.adjustBalance).toHaveBeenCalledWith(
      "profile",
      "ghost",
      null,
      null,
      500,
    );
  });

  it("does not create a balance for a nickname-shaped string that isn't a valid identity", async () => {
    const repo = repository({
      resolveViewer: vi.fn().mockResolvedValue({ status: "not_found" }),
    });
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({
        ...chat,
        viewerIsModerator: true,
        text: "!начислить призрак 500",
      }),
    ).resolves.toBe("Зритель «призрак» ещё не появлялся в чате");
    expect(repo.adjustBalance).not.toHaveBeenCalled();
  });

  it("refuses to guess when a nickname matches more than one viewer", async () => {
    const repo = repository({
      resolveViewer: vi.fn().mockResolvedValue({ status: "ambiguous" }),
    });
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({
        ...chat,
        viewerIsModerator: true,
        text: "!начислить @twins 500",
      }),
    ).resolves.toBe("Несколько зрителей с ником «twins» — уточните");
    expect(repo.adjustBalance).not.toHaveBeenCalled();
  });

  it("resolves a non-ASCII YouTube display name instead of using it as the balance identity", async () => {
    const repo = repository({
      resolveViewer: vi.fn().mockResolvedValue({
        status: "found",
        viewerKey: "ucviewer",
        displayName: "Виктор Стример",
      }),
      adjustBalance: vi.fn().mockResolvedValue({
        viewerKey: "ucviewer",
        displayName: "Виктор Стример",
        balance: 2_500,
      }),
    });
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({
        ...chat,
        provider: "youtube",
        viewerIsModerator: true,
        text: "!начислить Виктор_Стример 500",
      }),
    ).resolves.toBe("Виктор Стример получил 500 булочки");
    expect(repo.resolveViewer).toHaveBeenCalledWith(
      "profile",
      "виктор_стример",
    );
    expect(repo.adjustBalance).toHaveBeenCalledWith(
      "profile",
      "ucviewer",
      null,
      null,
      500,
    );
  });

  it("does not let viewers or moderators change event configuration through chat", async () => {
    const repo = repository();
    const service = new EventsService(repo);

    for (const text of [
      "!ивент название SCREAMER Ужас",
      "!ивент команда SCREAMER !испуг",
      "!ивент каталог SCREAMER выкл",
      "!ивент включить SCREAMER",
      "!ивент выключить SCREAMER",
    ]) {
      await expect(
        service.respondToChat({ ...chat, text }),
      ).resolves.toBeNull();
      await expect(
        service.respondToChat({
          ...chat,
          viewerIsModerator: true,
          text,
        }),
      ).resolves.toBeNull();
    }
    expect(repo.updateEventConfiguration).not.toHaveBeenCalled();
  });

  it("lets the broadcaster stop and invalidate all active effects", async () => {
    const repo = repository();
    const service = new EventsService(repo);

    await expect(
      service.stopAllEffects("owner", "creator"),
    ).resolves.toEqual({ controlRevision: "1" });
    expect(repo.stopEffects).toHaveBeenCalledWith(
      "creator",
      expect.any(Date),
    );
  });

  it("lets a Twitch-badge-resolved moderator update a fixed event through the UI API", async () => {
    const configured = eventDefinitions.map((event) => ({
      ...event,
      enabled: true,
      showInCatalog: true,
    }));
    const updateEventConfiguration = vi.fn().mockImplementation(
      async (_profileId, eventId, input) => ({
        ...configured.find((event) => event.id === eventId)!,
        ...input,
      }),
    );
    const service = new EventsService(
      repository({
        resolveRole: vi.fn().mockResolvedValue("moderator"),
        listEventConfigurations: vi.fn().mockResolvedValue(configured),
        updateEventConfiguration,
      }),
    );

    await service.updateEvent("moderator-account", "creator", "screamer", {
      command: "!испуг",
    });
    expect(updateEventConfiguration).toHaveBeenCalledWith(
      "profile",
      "screamer",
      { command: "!испуг" },
    );
  });

  it("lets the broadcaster update a fixed event through the UI API", async () => {
    const updateEventConfiguration = vi.fn().mockResolvedValue({
      ...eventDefinitions[0]!,
      enabled: true,
      showInCatalog: true,
      name: "Ужас",
    });
    const service = new EventsService(
      repository({ updateEventConfiguration }),
    );

    await service.updateEvent("owner", "creator", "screamer", {
      name: "Ужас",
    });
    expect(updateEventConfiguration).toHaveBeenCalledWith(
      "profile",
      "screamer",
      { name: "Ужас" },
    );
  });

  it("persists Twitch badge proof for moderator UI access", async () => {
    const repo = repository();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const service = new EventsService(repo, () => now);

    await service.respondToChat({
      ...chat,
      viewerIsModerator: true,
      text: "обычное сообщение",
    });

    expect(repo.rememberModeratorBadge).toHaveBeenCalledWith(
      "profile",
      "twitch",
      "123",
      "Viewer",
      now,
    );
  });

  it("persists moderator badge proof for non-Twitch providers too", async () => {
    const repo = repository();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const service = new EventsService(repo, () => now);

    await service.respondToChat({
      ...chat,
      provider: "youtube",
      viewerIsModerator: true,
      text: "обычное сообщение",
    });

    expect(repo.rememberModeratorBadge).toHaveBeenCalledWith(
      "profile",
      "youtube",
      "123",
      "Viewer",
      now,
    );
  });

  it("rejects attempts to add a custom effect type", async () => {
    const service = new EventsService(repository());

    await expect(
      service.updateEvent("owner", "creator", "my_custom_effect", {
        name: "Custom",
        command: "!custom",
        effectType: "MY_CUSTOM_EFFECT",
      }),
    ).rejects.toThrow();
  });

  it("does not list or execute a disabled event", async () => {
    const configured = eventDefinitions.map((event) => ({
      ...event,
      enabled: event.id !== "screamer",
      showInCatalog: event.id !== "screamer",
    }));
    const repo = repository({
      listEventConfigurations: vi.fn().mockResolvedValue(configured),
    });
    const service = new EventsService(repo);

    await expect(
      service.respondToChat({ ...chat, text: "!скример" }),
    ).resolves.toBeNull();
    await expect(
      service.respondToChat({ ...chat, text: "!ивенты" }),
    ).resolves.not.toContain("!скример");
    expect(repo.purchase).not.toHaveBeenCalled();
  });

  it("reports cooldown without charging the viewer", async () => {
    const service = new EventsService(
      repository({
        purchase: vi.fn().mockResolvedValue({
          status: "cooldown",
          remainingSeconds: 7,
        }),
      }),
    );

    await expect(
      service.respondToChat({ ...chat, text: "!тьма" }),
    ).resolves.toBe("Событие недоступно, осталось 7 секунд");
  });

  it("does not accept a purchase while the Castaryn Client is offline", async () => {
      const service = new EventsService(
        repository({
          purchase: vi.fn().mockResolvedValue({ status: "offline" }),
        }),
      );

      await expect(
        service.respondToChat({ ...chat, text: "!тьма" }),
      ).resolves.toBe("Castaryn Client не подключён. Баллы не списаны");
  });

  it("does not charge or launch an event while Castaryn Events is off", async () => {
    const service = new EventsService(
      repository({
        purchase: vi.fn().mockResolvedValue({ status: "disabled" }),
      }),
    );

    await expect(
      service.respondToChat({ ...chat, text: "!скример" }),
    ).resolves.toBe("Castaryn Events выключены. Баллы не списаны");
  });

  it("returns the complete built-in event catalog without pagination", async () => {
    const service = new EventsService(repository());

    const catalog = await service.respondToChat({
      ...chat,
      text: "!ивенты",
    });

    expect(catalog).toContain("👻 Скример\n!скример\n1000 булочки");
    expect(catalog).toContain("↕ Инверсия\n!инверсия\n1000 булочки");
    expect(catalog).not.toContain("1/");
    expect(catalog?.split("\n\n")).toHaveLength(eventDefinitions.length);
  });

  it("uses the saved name and command in !ивенты", async () => {
    const configured = eventDefinitions.map((event) =>
      event.id === "screamer"
        ? {
            ...event,
            name: "👻 Ужас",
            command: "!испуг",
            enabled: true,
            showInCatalog: true,
          }
        : { ...event, enabled: true, showInCatalog: true },
    );
    const service = new EventsService(
      repository({
        listEventConfigurations: vi.fn().mockResolvedValue(configured),
      }),
    );

    await expect(
      service.respondToChat({ ...chat, text: "!ивенты" }),
    ).resolves.toContain("👻 Ужас\n!испуг\n1000 булочки");
  });
});
