import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

const CreatorFeatureSchema = z.enum([
  "chat_commands",
  "moderators",
  "overlay",
  "remote_configuration",
  "events",
]);

const CreatorAccessSchema = z.object({
  active: z.boolean(),
  creatorIdentityId: z.string().uuid().nullable(),
  features: z.array(CreatorFeatureSchema),
  subscription: z
    .object({
      plan: z.enum(["trial", "monthly", "yearly", "lifetime"]),
      expiresAt: z.string().datetime().nullable(),
    })
    .nullable(),
});

const RuntimeConfigSchema = z.object({
  configured: z.boolean(),
  apiUrl: z.string().url().nullable(),
  oidcAuthority: z.string().url().nullable(),
  oidcClientId: z.string().nullable(),
  oidcAudience: z.string().nullable(),
});

const SessionSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});

const ApiResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.string(),
});

const TwitchConnectionSchema = z.object({
  connection: z
    .object({
      connectionId: z.string().uuid(),
      id: z.string(),
      login: z.string(),
      displayName: z.string(),
      connectedAt: z.string().datetime(),
    })
    .nullable(),
});

const YoutubeConnectionSchema = TwitchConnectionSchema;

const CommandSchema = z.object({
  id: z.string().uuid(),
  creatorIdentityId: z.string().uuid(),
  connectionId: z.string().uuid(),
  provider: z.enum(["twitch", "youtube"]),
  trigger: z.string(),
  responseTemplate: z.string(),
  accessLevel: z.enum(["everyone", "moderators", "creator"]),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const OverlayConfigurationSchema = z.object({
  id: z.string().uuid(),
  visibleFields: z.array(z.string()),
  theme: z.literal("dark"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const OverlayResultSchema = z.object({
  configuration: OverlayConfigurationSchema,
  publicToken: z.string().min(32).nullable(),
});

const CreatorWorkspaceSchema = z.object({
  creatorIdentityId: z.string().uuid(),
  role: z.enum(["owner", "moderator"]),
  channelName: z.string().nullable(),
  provider: z.string().nullable(),
});

const EventDefinitionSchema = z.object({
  id: z.string(),
  effectType: z.enum([
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
  ]),
  name: z.string(),
  command: z.string(),
  price: z.literal(1000),
  type: z.enum(["instant", "timed"]),
  durationSeconds: z.number().int(),
  cooldownSeconds: z.number().int(),
  effect: z.object({
    kind: z.string(),
    durationSeconds: z.number().int(),
    parameters: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
  }),
  enabled: z.boolean(),
  showInCatalog: z.boolean(),
});

const EventsProfileSchema = z.object({
  id: z.string().uuid(),
  creatorIdentityId: z.string().uuid(),
  connectionId: z.string().uuid(),
  name: z.string(),
  currencyName: z.string(),
  isEnabled: z.boolean(),
  controlRevision: z.string().regex(/^\d+$/),
});

const EventsConfigurationSchema = z.object({
  profile: EventsProfileSchema,
  events: z.array(EventDefinitionSchema),
});

const ViewerBalanceSchema = z.object({
  viewerKey: z.string(),
  displayName: z.string(),
  balance: z.number().int().nonnegative(),
});

const BalancePageSchema = z.object({
  items: z.array(ViewerBalanceSchema),
  nextCursor: z.string().nullable(),
});

const DispatchedEffectSchema = z.object({
  sequence: z.string().regex(/^\d+$/),
  id: z.string().uuid(),
  eventId: z.string(),
  viewerName: z.string(),
  effect: EventDefinitionSchema.shape.effect,
  createdAt: z.string().datetime(),
});

export type CreatorAccessSnapshot = z.infer<typeof CreatorAccessSchema>;
export type CreatorRuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type TwitchConnection = NonNullable<
  z.infer<typeof TwitchConnectionSchema>["connection"]
>;
export type YoutubeConnection = NonNullable<
  z.infer<typeof YoutubeConnectionSchema>["connection"]
>;
export type StreamingCommand = z.infer<typeof CommandSchema>;
export type CreatorWorkspace = z.infer<typeof CreatorWorkspaceSchema>;
export type EventsConfiguration = z.infer<typeof EventsConfigurationSchema>;
export type EventDefinition = z.infer<typeof EventDefinitionSchema>;
export type ViewerBalance = z.infer<typeof ViewerBalanceSchema>;
export type BalancePage = z.infer<typeof BalancePageSchema>;
export type DispatchedEffect = z.infer<typeof DispatchedEffectSchema>;

export type CommandInput = {
  provider?: "twitch" | "youtube";
  trigger: string;
  responseTemplate: string;
  accessLevel: "everyone" | "moderators" | "creator";
  enabled: boolean;
};

export type OverlayField =
  | "activity"
  | "pack"
  | "dungeon"
  | "next_dungeon"
  | "daily_quest"
  | "inventory_chests"
  | "timer"
  | "progress"
  | "chests"
  | "farm_time"
  | "server";

export type PublicStreamState = {
  activity: string | null;
  pack: string | null;
  dungeon: string | null;
  nextDungeon: string | null;
  dailyQuest: string | null;
  inventoryChests: number;
  timerSeconds: number;
  packsDone: number;
  packsTotal: number;
  dungeonsDone: number;
  dungeonsTotal: number;
  chests: number;
  farmTimeSeconds: number;
  server: string | null;
  player: string | null;
};

// Frozen: this is a shared singleton returned by reference to every caller
// on 401/no-session, so a future accidental mutation (e.g. `.features.push`)
// must fail loudly instead of silently leaking into unrelated call sites.
// `Object.freeze` mutates in place and returns the same reference, so the
// array keeps its normal (mutable-looking) type while being frozen at
// runtime -- no need to change the shared CreatorAccessSnapshot type.
const emptyPlayerAccessFeatures: CreatorAccessSnapshot["features"] = [];
Object.freeze(emptyPlayerAccessFeatures);

export const playerAccess: CreatorAccessSnapshot = Object.freeze({
  active: false,
  creatorIdentityId: null,
  features: emptyPlayerAccessFeatures,
  subscription: null,
});

let activeSession:
  | { accessToken: string; expiresAt: number }
  | null = null;
let restoreInFlight: Promise<boolean> | null = null;
let sessionEpoch = 0;

export async function loadCreatorRuntimeConfig() {
  if (!isTauri()) {
    return {
      configured: false,
      apiUrl: null,
      oidcAuthority: null,
      oidcClientId: null,
      oidcAudience: null,
    } satisfies CreatorRuntimeConfig;
  }
  return RuntimeConfigSchema.parse(await invoke("creator_runtime_config"));
}

export async function beginCreatorLogin(config: CreatorRuntimeConfig) {
  if (
    !config.configured ||
    !config.oidcAuthority ||
    !config.oidcClientId ||
    !config.oidcAudience
  ) {
    throw new Error("Creator environment is not configured");
  }
  const session = SessionSchema.parse(
    await invoke("begin_creator_login", {
      authority: config.oidcAuthority,
      clientId: config.oidcClientId,
      audience: config.oidcAudience,
    }),
  );
  rememberSession(session);
  window.dispatchEvent(new Event("castaryn-creator-session-changed"));
  return session;
}

export async function restoreCreatorLogin() {
  if (!isTauri()) return false;
  if (activeSession && activeSession.expiresAt > Date.now() + 15_000) {
    return true;
  }
  if (!restoreInFlight) {
    const epoch = sessionEpoch;
    restoreInFlight = (async () => {
      const session = SessionSchema.nullable().parse(
        await invoke("refresh_creator_login"),
      );
      if (!session || epoch !== sessionEpoch) return false;
      rememberSession(session);
      return true;
    })().finally(() => {
      restoreInFlight = null;
    });
  }
  return restoreInFlight;
}

export async function logoutCreator(creatorIdsToForget: string[] = []) {
  sessionEpoch += 1;
  activeSession = null;
  if (isTauri()) {
    await invoke("logout_creator");
    // The refresh-token entry above is keyed by session, but overlay tokens
    // are cached per creator workspace -- clear every one the user could
    // have visited so a shared/public machine doesn't keep them around
    // after sign-out.
    await Promise.all(
      creatorIdsToForget.map((creatorId) =>
        forgetOverlayToken(creatorId).catch(() => undefined),
      ),
    );
  }
  window.dispatchEvent(new Event("castaryn-creator-session-changed"));
}

export async function fetchCreatorAccess(): Promise<CreatorAccessSnapshot> {
  try {
    return parseCreatorAccess(await creatorRequest("/v1/creator/access"));
  } catch (error) {
    if (error instanceof CreatorUnauthorizedError) return playerAccess;
    throw error;
  }
}

export function parseCreatorAccess(input: unknown) {
  return CreatorAccessSchema.parse(input);
}

export async function beginTwitchConnection() {
  const response = z
    .object({ authorizeUrl: z.string().url() })
    .parse(
      await creatorRequest("/v1/connections/twitch/authorize", {
        method: "POST",
        body: {},
      }),
    );
  await invoke("open_twitch_authorization", {
    url: response.authorizeUrl,
  });
}

export async function listCreatorWorkspaces() {
  return z
    .array(CreatorWorkspaceSchema)
    .parse(await creatorRequest("/v1/creator/workspaces"));
}

export async function getTwitchConnection() {
  return TwitchConnectionSchema.parse(
    await creatorRequest("/v1/connections/twitch"),
  ).connection;
}

export async function disconnectTwitch() {
  await creatorRequest("/v1/connections/twitch", { method: "DELETE" });
}

export async function beginYoutubeConnection() {
  const response = z
    .object({ authorizeUrl: z.string().url() })
    .parse(
      await creatorRequest("/v1/connections/youtube/authorize", {
        method: "POST",
        body: {},
      }),
    );
  await invoke("open_youtube_authorization", {
    url: response.authorizeUrl,
  });
}

export async function getYoutubeConnection() {
  return YoutubeConnectionSchema.parse(
    await creatorRequest("/v1/connections/youtube"),
  ).connection;
}

export async function disconnectYoutube() {
  await creatorRequest("/v1/connections/youtube", { method: "DELETE" });
}

export async function listCommands(creatorId: string) {
  return z
    .array(CommandSchema)
    .parse(await creatorRequest(`/v1/creators/${creatorId}/commands`));
}

export async function saveCommand(
  creatorId: string,
  input: CommandInput,
  commandId?: string,
) {
  return CommandSchema.parse(
    await creatorRequest(
      commandId
        ? `/v1/creators/${creatorId}/commands/${commandId}`
        : `/v1/creators/${creatorId}/commands`,
      {
        method: commandId ? "PUT" : "POST",
        body: input,
      },
    ),
  );
}

export async function deleteCommand(
  creatorId: string,
  commandId: string,
) {
  await creatorRequest(
    `/v1/creators/${creatorId}/commands/${commandId}`,
    { method: "DELETE" },
  );
}

export async function previewCommand(
  creatorId: string,
  responseTemplate: string,
  state: PublicStreamState,
) {
  return z
    .object({ preview: z.string() })
    .parse(
      await creatorRequest(
        `/v1/creators/${creatorId}/commands/preview`,
        {
          method: "POST",
          body: { responseTemplate, state },
        },
      ),
    ).preview;
}

export async function getEventsConfiguration(creatorId: string) {
  return EventsConfigurationSchema.parse(
    await creatorRequest(`/v1/creators/${creatorId}/events`),
  );
}

export async function updateEventsProfile(
  creatorId: string,
  input: { name: string; currencyName: string; enabled: boolean },
) {
  return EventsProfileSchema.parse(
    await creatorRequest(`/v1/creators/${creatorId}/events/profile`, {
      method: "PUT",
      body: input,
    }),
  );
}

export async function stopAllEventEffects(creatorId: string) {
  return z
    .object({ controlRevision: z.string().regex(/^\d+$/) })
    .parse(
      await creatorRequest(`/v1/creators/${creatorId}/events/stop`, {
        method: "POST",
      }),
    );
}

export async function updateEventConfiguration(
  creatorId: string,
  eventId: string,
  input: {
    name?: string;
    command?: string;
    enabled?: boolean;
    showInCatalog?: boolean;
  },
) {
  return EventDefinitionSchema.parse(
    await creatorRequest(
      `/v1/creators/${creatorId}/events/${encodeURIComponent(eventId)}`,
      { method: "PUT", body: input },
    ),
  );
}

export async function listEventBalances(
  creatorId: string,
  query = "",
  cursor: string | null = null,
) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  const suffix = params.size ? `?${params.toString()}` : "";
  return BalancePageSchema.parse(
    await creatorRequest(
      `/v1/creators/${creatorId}/events/balances${suffix}`,
    ),
  );
}

export async function adjustEventBalance(
  creatorId: string,
  viewer: string,
  amount: number,
) {
  return ViewerBalanceSchema.parse(
    await creatorRequest(
      `/v1/creators/${creatorId}/events/balances/adjust`,
      { method: "POST", body: { viewer, amount } },
    ),
  );
}

export async function listEventEffects(
  creatorId: string,
  after = "0",
) {
  return z
    .array(DispatchedEffectSchema)
    .parse(
      await creatorRequest(
        `/v1/creators/${creatorId}/events/effects?after=${encodeURIComponent(after)}`,
      ),
    );
}

export async function getEventEffectCursor(creatorId: string) {
  return z
    .object({ sequence: z.string().regex(/^\d+$/) })
    .parse(
      await creatorRequest(
        `/v1/creators/${creatorId}/events/effects/cursor`,
      ),
    );
}

export async function heartbeatEventDesktop(
  creatorId: string,
  consumerId: string,
) {
  return z
    .object({ controlRevision: z.string().regex(/^\d+$/) })
    .parse(
      await creatorRequest(
        `/v1/creators/${creatorId}/events/heartbeat`,
        { method: "POST", body: { consumerId } },
      ),
    );
}

export async function acknowledgeEventEffect(
  creatorId: string,
  effectId: string,
) {
  await creatorRequest(
    `/v1/creators/${creatorId}/events/effects/${encodeURIComponent(effectId)}/ack`,
    { method: "POST" },
  );
}

export async function saveOverlay(
  creatorId: string,
  visibleFields: OverlayField[],
  rotateToken = false,
) {
  return OverlayResultSchema.parse(
    await creatorRequest(`/v1/creators/${creatorId}/overlay`, {
      method: "PUT",
      body: { visibleFields, rotateToken },
    }),
  );
}

export async function getOverlay(creatorId: string) {
  return OverlayConfigurationSchema.nullable().parse(
    await creatorRequest(`/v1/creators/${creatorId}/overlay`),
  );
}

export async function publishOverlayState(
  creatorId: string,
  state: PublicStreamState,
) {
  await creatorRequest(`/v1/creators/${creatorId}/overlay/state`, {
    method: "PUT",
    body: state,
  });
}

export async function buildOverlayUrl(publicToken: string) {
  const config = await loadCreatorRuntimeConfig();
  if (!config.apiUrl) throw new Error("Creator API is not configured");
  return new URL(`/overlay/${publicToken}`, config.apiUrl).toString();
}

export async function rememberOverlayToken(
  creatorId: string,
  publicToken: string,
) {
  if (isTauri()) {
    await invoke("save_overlay_token", { creatorId, publicToken });
  }
}

export async function loadOverlayUrl(creatorId: string) {
  if (!isTauri()) return "";
  const token = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable()
    .parse(await invoke("load_overlay_token", { creatorId }));
  return token ? buildOverlayUrl(token) : "";
}

export async function forgetOverlayToken(creatorId: string) {
  if (isTauri()) await invoke("delete_overlay_token", { creatorId });
}

function rememberSession(session: z.infer<typeof SessionSchema>) {
  activeSession = {
    accessToken: session.accessToken,
    expiresAt: Date.now() + session.expiresIn * 1000,
  };
}

async function requireSessionAccessToken() {
  if (!activeSession || activeSession.expiresAt <= Date.now() + 15_000) {
    const restored = await restoreCreatorLogin();
    if (!restored) throw new CreatorUnauthorizedError();
  }
  const session = activeSession;
  if (!session) throw new CreatorUnauthorizedError();
  return session.accessToken;
}

async function creatorRequest(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
  } = {},
) {
  let accessToken = await requireSessionAccessToken();
  let response = ApiResponseSchema.parse(
    await invoke("creator_api_request", {
      method: options.method ?? "GET",
      path,
      accessToken,
      body:
        options.body === undefined
          ? null
          : JSON.stringify(options.body),
    }),
  );
  if (response.status === 401) {
    activeSession = null;
    accessToken = await requireSessionAccessToken();
    response = ApiResponseSchema.parse(
      await invoke("creator_api_request", {
        method: options.method ?? "GET",
        path,
        accessToken,
        body:
          options.body === undefined
            ? null
            : JSON.stringify(options.body),
      }),
    );
    if (response.status === 401) {
      activeSession = null;
      throw new CreatorUnauthorizedError();
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CreatorApiError(response.status);
  }
  return response.body ? JSON.parse(response.body) : null;
}

export class CreatorUnauthorizedError extends Error {}
export class CreatorApiError extends Error {
  constructor(readonly status: number) {
    super(`Creator API request failed (${status})`);
  }
}
