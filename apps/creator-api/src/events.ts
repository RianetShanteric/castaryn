import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { can, type CreatorPermission, type CreatorRole } from "./authorization.js";

export const EVENTS_PRICE = 1_000;
export const EFFECT_DELIVERY_TIMEOUT_SECONDS = 15;
export const EventTypeSchema = z.enum([
  "SCREAMER",
  "SOUND",
  "TEXT_MEME",
  "SHAKE",
  "DARK",
  "SCREEN_ROTATE",
  "MOUSE_BLOCK",
  "KEYBOARD_BLOCK",
  "KEY_REMAP",
  "INPUT_DELAY",
  "MOUSE_INVERT",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventEffectSchema = z.object({
  kind: z.enum([
    "screamer",
    "sound",
    "meme",
    "shake",
    "darkness",
    "rotate",
    "mouse_block",
    "keyboard_block",
    "key_shuffle",
    "lag",
    "mouse_invert",
  ]),
  durationSeconds: z.number().int().min(1).max(30),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export type EventEffect = z.infer<typeof EventEffectSchema>;

export type EventDefinition = {
  id: string;
  effectType: EventType;
  name: string;
  command: string;
  price: 1000;
  type: "instant" | "timed";
  durationSeconds: number;
  cooldownSeconds: number;
  effect: EventEffect;
};

const instant = (
  id: string,
  effectType: EventType,
  name: string,
  command: string,
  kind: EventEffect["kind"],
  durationSeconds: number,
  parameters: EventEffect["parameters"] = {},
): EventDefinition => ({
  id,
  effectType,
  name,
  command,
  price: EVENTS_PRICE,
  type: "instant",
  durationSeconds,
  cooldownSeconds: 10,
  effect: { kind, durationSeconds, parameters },
});

const timed = (
  id: string,
  effectType: EventType,
  name: string,
  command: string,
  kind: EventEffect["kind"],
  durationSeconds: number,
  parameters: EventEffect["parameters"] = {},
): EventDefinition => ({
  id,
  effectType,
  name,
  command,
  price: EVENTS_PRICE,
  type: "timed",
  durationSeconds,
  cooldownSeconds: durationSeconds,
  effect: { kind, durationSeconds, parameters },
});

export const eventDefinitions: readonly EventDefinition[] = [
  instant("screamer", "SCREAMER", "👻 Скример", "!скример", "screamer", 4, {
    assetPool: "castaryn_screamer_v1",
    audioPool: "castaryn_scare_v1",
  }),
  instant("random_sound", "SOUND", "🔊 Звук", "!звук", "sound", 3, {
    audioPool: "castaryn_fun_v1",
  }),
  instant("meme", "TEXT_MEME", "💬 Мем", "!мем", "meme", 5, {
    textPool: "castaryn_memes_v1",
  }),
  timed("shake", "SHAKE", "📳 Тряска", "!тряска", "shake", 10),
  timed("darkness", "DARK", "🌑 Тьма", "!тьма", "darkness", 10),
  timed("rotate", "SCREEN_ROTATE", "🔄 Переворот", "!переворот", "rotate", 10, {
    systemEffect: true,
  }),
  timed("mouse_block", "MOUSE_BLOCK", "🖱 Мышь", "!мышь", "mouse_block", 20, {
    systemEffect: true,
  }),
  timed(
    "keyboard_block",
    "KEYBOARD_BLOCK",
    "⌨ Блокировка клавиатуры",
    "!клавиатура",
    "keyboard_block",
    20,
    { systemEffect: true },
  ),
  timed("key_shuffle", "KEY_REMAP", "🎲 Клавиши", "!клавиши", "key_shuffle", 20, {
    systemEffect: true,
  }),
  timed("lag", "INPUT_DELAY", "🐌 Лаги", "!лаги", "lag", 30, { systemEffect: true }),
  timed("mouse_invert", "MOUSE_INVERT", "↕ Инверсия", "!инверсия", "mouse_invert", 30, {
    systemEffect: true,
  }),
] as const;

const reservedCommands = new Set([
  "!ивент",
  "!ивенты",
  "!баланс",
  "!начислить",
  "!списать",
  ...eventDefinitions.map((definition) => definition.command),
]);
const protectedCommands = new Set([
  "!ивент",
  "!ивенты",
  "!баланс",
  "!начислить",
  "!списать",
]);

export function isReservedEventCommand(command: string) {
  return reservedCommands.has(command.toLowerCase());
}

export type EventsProfile = {
  id: string;
  creatorIdentityId: string;
  connectionId: string;
  name: string;
  currencyName: string;
  isEnabled: boolean;
  controlRevision: string;
};

export type ConfiguredEvent = EventDefinition & {
  enabled: boolean;
  showInCatalog: boolean;
};

export type ViewerBalance = {
  viewerKey: string;
  displayName: string;
  balance: number;
};

export type BalancePage = {
  items: ViewerBalance[];
  nextCursor: string | null;
};

export const MAX_BALANCE_PAGE_SIZE = 100;
export const DEFAULT_BALANCE_PAGE_SIZE = 50;

export type DispatchedEffect = {
  sequence: string;
  id: string;
  eventId: string;
  viewerName: string;
  effect: EventEffect;
  createdAt: string;
};

export type PurchaseResult =
  | { status: "purchased"; balance: number; effect: DispatchedEffect }
  | { status: "cooldown"; remainingSeconds: number }
  | { status: "insufficient"; balance: number }
  | { status: "disabled" }
  | { status: "offline" };

export type ConsumerKind = "desktop" | "overlay";

export type ViewerLookup =
  | { status: "found"; viewerKey: string; displayName: string }
  | { status: "not_found" }
  | { status: "ambiguous" };

export interface EventsRepository {
  resolveRole(actorUserId: string, creatorIdentityId: string): Promise<CreatorRole | null>;
  rememberModeratorBadge(
    profileId: string,
    provider: string,
    externalUserId: string,
    displayName: string,
    verifiedAt: Date,
  ): Promise<void>;
  getOrCreateProfileForCreator(creatorIdentityId: string): Promise<EventsProfile>;
  getOrCreateProfileForChannel(
    provider: string,
    externalChannelId: string,
  ): Promise<EventsProfile | null>;
  updateProfile(
    creatorIdentityId: string,
    input: { name: string; currencyName: string; enabled: boolean },
  ): Promise<EventsProfile>;
  stopEffects(
    creatorIdentityId: string,
    now: Date,
  ): Promise<{ controlRevision: string }>;
  listEventConfigurations(profileId: string): Promise<ConfiguredEvent[]>;
  updateEventConfiguration(
    profileId: string,
    eventId: string,
    input: {
      name?: string;
      command?: string;
      enabled?: boolean;
      showInCatalog?: boolean;
    },
  ): Promise<ConfiguredEvent | null>;
  getBalance(
    profileId: string,
    viewerKey: string,
    displayName: string,
    externalViewerId: string | null,
  ): Promise<ViewerBalance>;
  adjustBalance(
    profileId: string,
    viewerKey: string,
    displayName: string | null,
    externalViewerId: string | null,
    amount: number,
  ): Promise<ViewerBalance | null>;
  // Resolves a moderator- or creator-typed search string (a display name,
  // which is neither unique nor stable, especially on YouTube) to the
  // actual stable viewer_key of an existing balance row. Must never create
  // a new row -- that is what let a mistyped/malicious name silently create
  // or collide with an unrelated viewer's balance.
  resolveViewer(profileId: string, typed: string): Promise<ViewerLookup>;
  listBalances(
    profileId: string,
    query: string | null,
    cursor: string | null,
    limit: number,
  ): Promise<BalancePage>;
  purchase(input: {
    profileId: string;
    viewerKey: string;
    displayName: string;
    externalViewerId: string | null;
    definition: EventDefinition;
    now: Date;
  }): Promise<PurchaseResult>;
  listEffects(
    creatorIdentityId: string,
    afterSequence: string,
  ): Promise<DispatchedEffect[]>;
  listPublicEffects(
    publicTokenHash: string,
    afterSequence: string,
  ): Promise<DispatchedEffect[] | null>;
  latestSequence(creatorIdentityId: string): Promise<string>;
  latestPublicSequence(publicTokenHash: string): Promise<string | null>;
  heartbeat(
    creatorIdentityId: string,
    kind: "desktop",
    consumerId: string,
    now: Date,
  ): Promise<{ controlRevision: string }>;
  heartbeatPublic(
    publicTokenHash: string,
    consumerId: string,
    now: Date,
  ): Promise<{ controlRevision: string } | null>;
  acknowledge(
    creatorIdentityId: string,
    effectId: string,
    kind: "desktop",
    now: Date,
  ): Promise<boolean>;
  acknowledgePublic(
    publicTokenHash: string,
    effectId: string,
    now: Date,
  ): Promise<boolean>;
  refundTimedOut(now: Date): Promise<number>;
}

const ViewerKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{1,64}$/);

// A human-typed search string used to *find* an existing viewer (moderator
// "!начислить <ник>" or the creator dashboard's adjust form) -- unlike
// ViewerKeySchema this must accept arbitrary display names (Cyrillic,
// spaces, emoji), since it is never itself used as a balance identity.
const ViewerSearchSchema = z.string().trim().toLowerCase().min(1).max(64);

export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly randomAssetIndex: () => number = () => randomInt(1, 6),
  ) {}

  async getProfile(actorUserId: string, creatorIdentityId: string) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:view");
    const profile =
      await this.repository.getOrCreateProfileForCreator(creatorIdentityId);
    return {
      profile,
      events: await this.repository.listEventConfigurations(profile.id),
    };
  }

  async updateEvent(
    actorUserId: string,
    creatorIdentityId: string,
    eventId: string,
    input: unknown,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "events:configure",
    );
    const profile =
      await this.repository.getOrCreateProfileForCreator(creatorIdentityId);
    const parsed = EventConfigurationInputSchema.parse(input);
    const events = await this.repository.listEventConfigurations(profile.id);
    assertAllowedCommand(parsed.command, eventId, events);
    const updated = await this.repository.updateEventConfiguration(
      profile.id,
      z.string().min(1).max(48).parse(eventId),
      parsed,
    );
    if (!updated) throw new EventsEffectNotFoundError();
    return updated;
  }

  async updateProfile(
    actorUserId: string,
    creatorIdentityId: string,
    input: unknown,
  ) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:profile");
    const parsed = z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[^\p{C}\r\n]+$/u),
        currencyName: z
          .string()
          .trim()
          .min(1)
          .max(32)
          .regex(/^[^\p{C}\r\n]+$/u),
        enabled: z.boolean(),
      })
      .strict()
      .parse(input);
    await this.repository.getOrCreateProfileForCreator(creatorIdentityId);
    return this.repository.updateProfile(creatorIdentityId, parsed);
  }

  async stopAllEffects(actorUserId: string, creatorIdentityId: string) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "events:profile",
    );
    return this.repository.stopEffects(creatorIdentityId, this.now());
  }

  async listBalances(
    actorUserId: string,
    creatorIdentityId: string,
    query: string | null,
    cursor: string | null,
    limit = DEFAULT_BALANCE_PAGE_SIZE,
  ) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:manage");
    const profile =
      await this.repository.getOrCreateProfileForCreator(creatorIdentityId);
    const safeQuery = query
      ? z.string().trim().max(64).parse(query).toLowerCase()
      : null;
    const safeLimit = Math.min(
      MAX_BALANCE_PAGE_SIZE,
      Math.max(1, Math.trunc(limit) || DEFAULT_BALANCE_PAGE_SIZE),
    );
    return this.repository.listBalances(profile.id, safeQuery, cursor, safeLimit);
  }

  async adjustBalance(
    actorUserId: string,
    creatorIdentityId: string,
    input: unknown,
  ) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:manage");
    const parsed = z
      .object({
        viewer: ViewerSearchSchema,
        amount: z.number().int().min(-1_000_000).max(1_000_000).refine(Boolean),
      })
      .strict()
      .parse(input);
    const profile =
      await this.repository.getOrCreateProfileForCreator(creatorIdentityId);
    const viewerKey = await this.resolveOrClaimViewerKey(
      profile.id,
      parsed.viewer,
    );
    if (viewerKey === "ambiguous") throw new AmbiguousViewerError();
    if (viewerKey === null) throw new ViewerNotFoundError();
    const result = await this.repository.adjustBalance(
      profile.id,
      viewerKey,
      null,
      null,
      parsed.amount,
    );
    if (!result) throw new InsufficientEventBalanceError();
    return result;
  }

  async listEffects(
    actorUserId: string,
    creatorIdentityId: string,
    afterSequence: string,
  ) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:consume");
    return this.repository.listEffects(
      creatorIdentityId,
      parseSequence(afterSequence),
    );
  }

  async latestSequence(actorUserId: string, creatorIdentityId: string) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:consume");
    return {
      sequence: await this.repository.latestSequence(creatorIdentityId),
    };
  }

  async heartbeat(
    actorUserId: string,
    creatorIdentityId: string,
    input: unknown,
  ) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:consume");
    const { consumerId } = z
      .object({ consumerId: z.string().min(8).max(96) })
      .strict()
      .parse(input);
    return this.repository.heartbeat(
      creatorIdentityId,
      "desktop",
      consumerId,
      this.now(),
    );
  }

  async acknowledge(
    actorUserId: string,
    creatorIdentityId: string,
    effectId: string,
  ) {
    await this.requirePermission(actorUserId, creatorIdentityId, "events:consume");
    const acknowledged = await this.repository.acknowledge(
      creatorIdentityId,
      z.string().uuid().parse(effectId),
      "desktop",
      this.now(),
    );
    if (!acknowledged) throw new EventsEffectNotFoundError();
  }

  listPublicEffects(publicToken: string, afterSequence: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) return null;
    return this.repository.listPublicEffects(
      createHash("sha256").update(publicToken).digest("hex"),
      parseSequence(afterSequence),
    );
  }

  latestPublicSequence(publicToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) return null;
    return this.repository.latestPublicSequence(
      createHash("sha256").update(publicToken).digest("hex"),
    );
  }

  heartbeatPublic(publicToken: string, input: unknown) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) return null;
    const { consumerId } = z
      .object({ consumerId: z.string().min(8).max(96) })
      .strict()
      .parse(input);
    return this.repository.heartbeatPublic(
      createHash("sha256").update(publicToken).digest("hex"),
      consumerId,
      this.now(),
    );
  }

  acknowledgePublic(publicToken: string, effectId: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) return null;
    return this.repository.acknowledgePublic(
      createHash("sha256").update(publicToken).digest("hex"),
      z.string().uuid().parse(effectId),
      this.now(),
    );
  }

  refundTimedOut() {
    return this.repository.refundTimedOut(this.now());
  }

  async respondToChat(input: {
    provider: string;
    externalChannelId: string;
    viewerExternalId: string;
    viewerKey: string;
    viewerName: string;
    viewerIsModerator: boolean;
    text: string;
  }): Promise<string | null> {
    const words = input.text.trim().split(/\s+/);
    const command = words[0]?.toLowerCase();
    if (!command?.startsWith("!") && !input.viewerIsModerator) return null;
    const profile = await this.repository.getOrCreateProfileForChannel(
      input.provider,
      input.externalChannelId,
    );
    if (!profile) return null;
    if (input.viewerIsModerator) {
      await this.repository.rememberModeratorBadge(
        profile.id,
        input.provider,
        input.viewerExternalId,
        input.viewerName,
        this.now(),
      );
    }
    if (!command?.startsWith("!")) return null;
    const configuredEvents =
      await this.repository.listEventConfigurations(profile.id);
    const definition = configuredEvents.find(
      (event) => event.enabled && event.command === command,
    );
    if (
      !definition &&
      !["!баланс", "!ивенты", "!начислить", "!списать"].includes(
        command,
      )
    ) {
      return null;
    }
    const viewerKey = ViewerKeySchema.parse(input.viewerKey);
    const currencyName = profile.currencyName.toLocaleLowerCase("ru-RU");

    if (command === "!баланс") {
      const current = await this.repository.getBalance(
        profile.id,
        viewerKey,
        input.viewerName,
        input.viewerExternalId,
      );
      return `Ваш баланс: ${current.balance} ${currencyName}`;
    }
    if (command === "!ивенты") {
      if (words.length !== 1) return "Использование: !ивенты";
      return configuredEvents
        .filter((event) => event.enabled && event.showInCatalog)
        .map(
          (event) =>
            `${event.name}\n${event.command}\n${event.price} ${currencyName}`,
        )
        .join("\n\n");
    }
    if (command === "!начислить" || command === "!списать") {
      if (!input.viewerIsModerator) return null;
      const target = words[1]?.replace(/^@/, "");
      const amount = Number(words[2]);
      const parsedTarget = target ? ViewerSearchSchema.safeParse(target) : null;
      if (
        !parsedTarget?.success ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount > 1_000_000
      ) {
        return `Использование: ${command} <ник> <количество>`;
      }
      // Resolve the moderator-typed nickname to an existing viewer_key
      // instead of using it as one directly -- a typed nickname is a
      // display name, not a stable identity (this matters most on
      // YouTube, where display names are neither unique nor ASCII-safe).
      // If nobody matches, this can still create a fresh balance, but only
      // when the typed text is itself identity-shaped (see
      // resolveOrClaimViewerKey) -- e.g. a Twitch login typed ahead of that
      // viewer's first chat message.
      const viewerKey = await this.resolveOrClaimViewerKey(
        profile.id,
        parsedTarget.data,
      );
      if (viewerKey === "ambiguous") {
        return `Несколько зрителей с ником «${target}» — уточните`;
      }
      if (viewerKey === null) {
        return `Зритель «${target}» ещё не появлялся в чате`;
      }
      const delta = command === "!начислить" ? amount : -amount;
      const adjusted = await this.repository.adjustBalance(
        profile.id,
        viewerKey,
        null,
        null,
        delta,
      );
      if (!adjusted) return `Недостаточно ${currencyName} для списания`;
      return command === "!начислить"
        ? `${adjusted.displayName} получил ${amount} ${currencyName}`
        : `У ${adjusted.displayName} списано ${amount} ${currencyName}`;
    }

    if (!definition) return null;
    const selectedDefinition = materializeEventAssets(
      definition,
      this.randomAssetIndex,
    );
    const result = await this.repository.purchase({
      profileId: profile.id,
      viewerKey,
      displayName: input.viewerName,
      externalViewerId: input.viewerExternalId,
      definition: selectedDefinition,
      now: this.now(),
    });
    if (result.status === "cooldown") {
      return `Событие недоступно, осталось ${result.remainingSeconds} секунд`;
    }
    if (result.status === "insufficient") {
      return `Недостаточно ${currencyName}. Баланс: ${result.balance}`;
    }
    if (result.status === "offline") {
      return "Castaryn Client не подключён. Баллы не списаны";
    }
    if (result.status === "disabled") {
      return "Castaryn Events выключены. Баллы не списаны";
    }
    return `${input.viewerName} активировал ${definition.name}`;
  }

  private async requirePermission(
    actorUserId: string,
    creatorIdentityId: string,
    permission: CreatorPermission,
  ) {
    const role = await this.repository.resolveRole(actorUserId, creatorIdentityId);
    if (!role || !can(role, permission)) throw new EventsForbiddenError();
  }

  // Resolves a moderator-/creator-typed nickname to an existing viewer_key,
  // falling back to *creating* a balance under the typed text only when
  // that text is itself a valid, stable identity (ViewerKeySchema -- ASCII,
  // no spaces, e.g. a Twitch login). This restores the old "grant currency
  // to someone who hasn't chatted yet" convenience without reopening the
  // hole a display name-shaped string would: since resolveViewer already
  // confirmed no existing viewer_key or display_name matches, creating a
  // new row here can never collide with or steal an existing viewer's
  // balance -- at worst it is an orphan pot under a name nobody real ever
  // types. Returns null when the typed text cannot resolve or be created,
  // "ambiguous" when multiple existing viewers share that display name.
  private async resolveOrClaimViewerKey(
    profileId: string,
    typed: string,
  ): Promise<string | null | "ambiguous"> {
    const lookup = await this.repository.resolveViewer(profileId, typed);
    if (lookup.status === "found") return lookup.viewerKey;
    if (lookup.status === "ambiguous") return "ambiguous";
    const identity = ViewerKeySchema.safeParse(typed);
    return identity.success ? identity.data : null;
  }
}

function materializeEventAssets(
  definition: ConfiguredEvent,
  randomAssetIndex: () => number,
): EventDefinition {
  const parameters = { ...definition.effect.parameters };
  if (definition.effect.kind === "screamer") {
    parameters.visualAsset = randomAssetIndex();
    parameters.audioAsset = randomAssetIndex();
  } else if (definition.effect.kind === "sound") {
    parameters.audioAsset = randomAssetIndex();
  } else if (definition.effect.kind === "meme") {
    parameters.memeAsset = randomAssetIndex();
  }
  return {
    ...definition,
    effect: {
      ...definition.effect,
      parameters,
    },
  };
}

function parseSequence(value: string) {
  return /^\d{1,20}$/.test(value) ? value : "0";
}

const EventConfigurationInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[^\p{C}\r\n]+$/u)
      .optional(),
    command: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^![\p{L}\p{N}_]{1,31}$/u)
      .optional(),
    enabled: z.boolean().optional(),
    showInCatalog: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

function assertAllowedCommand(
  command: string | undefined,
  eventId: string,
  events: ConfiguredEvent[],
) {
  if (
    command &&
    (protectedCommands.has(command) ||
      events.some((event) => event.id !== eventId && event.command === command))
  ) {
    throw new EventsCommandConflictError();
  }
}

export class EventsForbiddenError extends Error {}
export class InsufficientEventBalanceError extends Error {}
export class EventsEffectNotFoundError extends Error {}
export class EventsCommandConflictError extends Error {}
export class ViewerNotFoundError extends Error {}
export class AmbiguousViewerError extends Error {}
