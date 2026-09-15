import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  can,
  type CreatorPermission,
  type CreatorRole,
} from "./authorization.js";
import { StreamingProviderIdSchema } from "./streaming-provider.js";
import { isReservedEventCommand } from "./events.js";

export const CommandAccessSchema = z.enum([
  "everyone",
  "moderators",
  "creator",
]);
export type CommandAccess = z.infer<typeof CommandAccessSchema>;

export const CommandInputSchema = z.object({
  trigger: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^![\p{L}\p{N}_]{1,31}$/u),
  responseTemplate: z.string().trim().min(1).max(450),
  accessLevel: CommandAccessSchema.default("everyone"),
  enabled: z.boolean().default(true),
});

const CommandRequestSchema = CommandInputSchema.extend({
  provider: StreamingProviderIdSchema.default("twitch"),
});

export const OverlayFieldSchema = z.enum([
  "activity",
  "pack",
  "dungeon",
  "next_dungeon",
  "daily_quest",
  "inventory_chests",
  "timer",
  "progress",
  "chests",
  "farm_time",
  "server",
]);
export type OverlayField = z.infer<typeof OverlayFieldSchema>;

export const OverlayConfigInputSchema = z.object({
  visibleFields: z
    .array(OverlayFieldSchema)
    .min(1)
    .max(11)
    .transform((fields) => [...new Set(fields)]),
  rotateToken: z.boolean().default(false),
});

export const PublicStreamStateSchema = z
  .object({
    activity: z.string().trim().max(80).nullable().default(null),
    pack: z.string().trim().max(80).nullable().default(null),
    dungeon: z.string().trim().max(80).nullable().default(null),
    nextDungeon: z.string().trim().max(80).nullable().default(null),
    dailyQuest: z.string().trim().max(80).nullable().default(null),
    inventoryChests: z.number().int().nonnegative().max(100_000_000).default(0),
    timerSeconds: z.number().int().nonnegative().max(604_800).default(0),
    packsDone: z.number().int().nonnegative().max(10_000).default(0),
    packsTotal: z.number().int().nonnegative().max(10_000).default(0),
    dungeonsDone: z.number().int().nonnegative().max(100_000).default(0),
    dungeonsTotal: z.number().int().nonnegative().max(100_000).default(0),
    chests: z.number().int().nonnegative().max(10_000_000).default(0),
    farmTimeSeconds: z.number().int().nonnegative().max(31_536_000).default(0),
    server: z.string().trim().max(64).nullable().default(null),
    player: z.string().trim().max(64).nullable().default(null),
  })
  .strict();
export type PublicStreamState = z.infer<typeof PublicStreamStateSchema>;

export type StreamingCommand = z.infer<typeof CommandInputSchema> & {
  id: string;
  creatorIdentityId: string;
  connectionId: string;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
};

export type OverlayConfiguration = {
  id: string;
  visibleFields: OverlayField[];
  theme: "dark";
  createdAt: Date;
  updatedAt: Date;
};

export type PublicOverlaySnapshot = {
  creatorIdentityId: string;
  configuration: OverlayConfiguration;
  state: PublicStreamState;
  revision: number;
  updatedAt: Date;
};

export interface CreatorFeaturesRepository {
  listAccessibleCreators(actorUserId: string): Promise<
    Array<{
      creatorIdentityId: string;
      role: CreatorRole;
      channelName: string | null;
      provider: string | null;
    }>
  >;
  resolveRole(
    actorUserId: string,
    creatorIdentityId: string,
  ): Promise<CreatorRole | null>;
  findActiveConnectionId(
    creatorIdentityId: string,
    provider: string,
  ): Promise<string | null>;
  listCommands(creatorIdentityId: string): Promise<StreamingCommand[]>;
  findCommandForChannel(
    provider: string,
    externalChannelId: string,
    trigger: string,
  ): Promise<StreamingCommand | null>;
  findLatestOverlayState(
    creatorIdentityId: string,
  ): Promise<PublicStreamState>;
  acquireCommandCooldown(input: {
    commandId: string;
    channelId: string;
    chatterUserId: string;
    now: Date;
    channelWindowMs: number;
    userWindowMs: number;
  }): Promise<boolean>;
  createCommand(
    creatorIdentityId: string,
    connectionId: string,
    actorUserId: string,
    input: z.infer<typeof CommandInputSchema>,
  ): Promise<StreamingCommand>;
  updateCommand(
    creatorIdentityId: string,
    commandId: string,
    input: z.infer<typeof CommandInputSchema>,
  ): Promise<StreamingCommand | null>;
  deleteCommand(
    creatorIdentityId: string,
    commandId: string,
  ): Promise<boolean>;
  upsertOverlayConfiguration(
    creatorIdentityId: string,
    publicTokenHash: string | null,
    fields: OverlayField[],
  ): Promise<OverlayConfiguration>;
  hasOverlayConfiguration(creatorIdentityId: string): Promise<boolean>;
  findOverlayConfiguration(
    creatorIdentityId: string,
  ): Promise<OverlayConfiguration | null>;
  updateOverlayState(
    creatorIdentityId: string,
    state: PublicStreamState,
  ): Promise<{ revision: number; updatedAt: Date }>;
  findOverlayByTokenHash(
    tokenHash: string,
  ): Promise<PublicOverlaySnapshot | null>;
}

export class CreatorFeaturesService {
  constructor(private readonly repository: CreatorFeaturesRepository) {}

  listAccessibleCreators(actorUserId: string) {
    return this.repository.listAccessibleCreators(actorUserId);
  }

  async listCommands(actorUserId: string, creatorIdentityId: string) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "commands:preview",
    );
    return this.repository.listCommands(creatorIdentityId);
  }

  async createCommand(
    actorUserId: string,
    creatorIdentityId: string,
    input: unknown,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "commands:create",
    );
    const request = CommandRequestSchema.parse(input);
    const { provider, ...parsed } = request;
    if (isReservedEventCommand(parsed.trigger)) {
      throw new ReservedStreamingCommandError();
    }
    validateTemplate(parsed.responseTemplate);
    const connectionId = await this.repository.findActiveConnectionId(
      creatorIdentityId,
      provider,
    );
    if (!connectionId) {
      throw new MissingStreamingConnectionError();
    }
    return this.repository.createCommand(
      creatorIdentityId,
      connectionId,
      actorUserId,
      parsed,
    );
  }

  async updateCommand(
    actorUserId: string,
    creatorIdentityId: string,
    commandId: string,
    input: unknown,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "commands:update",
    );
    const parsed = CommandInputSchema.parse(input);
    if (isReservedEventCommand(parsed.trigger)) {
      throw new ReservedStreamingCommandError();
    }
    validateTemplate(parsed.responseTemplate);
    const command = await this.repository.updateCommand(
      creatorIdentityId,
      commandId,
      parsed,
    );
    if (!command) throw new FeatureResourceNotFoundError();
    return command;
  }

  async deleteCommand(
    actorUserId: string,
    creatorIdentityId: string,
    commandId: string,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "commands:delete",
    );
    if (
      !(await this.repository.deleteCommand(creatorIdentityId, commandId))
    ) {
      throw new FeatureResourceNotFoundError();
    }
  }

  async previewCommand(
    actorUserId: string,
    creatorIdentityId: string,
    template: string,
    state: unknown,
  ) {
    const role = await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "commands:preview",
    );
    validateTemplate(template);
    const previewState =
      role === "moderator"
        ? await this.repository.findLatestOverlayState(creatorIdentityId)
        : PublicStreamStateSchema.parse(state);
    return renderTemplate(template, previewState);
  }

  async saveOverlayConfiguration(
    actorUserId: string,
    creatorIdentityId: string,
    input: unknown,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "overlay:manage",
    );
    const parsed = OverlayConfigInputSchema.parse(input);
    const exists =
      await this.repository.hasOverlayConfiguration(creatorIdentityId);
    const publicToken =
      !exists || parsed.rotateToken
        ? randomBytes(32).toString("base64url")
        : null;
    const configuration =
      await this.repository.upsertOverlayConfiguration(
        creatorIdentityId,
        publicToken ? hashPublicToken(publicToken) : null,
        parsed.visibleFields,
      );
    return { configuration, publicToken };
  }

  async getOverlayConfiguration(
    actorUserId: string,
    creatorIdentityId: string,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "overlay:manage",
    );
    return this.repository.findOverlayConfiguration(creatorIdentityId);
  }

  async publishOverlayState(
    actorUserId: string,
    creatorIdentityId: string,
    input: unknown,
  ) {
    await this.requirePermission(
      actorUserId,
      creatorIdentityId,
      "overlay:manage",
    );
    const result = await this.repository.updateOverlayState(
      creatorIdentityId,
      PublicStreamStateSchema.parse(input),
    );
    return result;
  }

  getPublicOverlay(publicToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(publicToken)) {
      return null;
    }
    return this.repository.findOverlayByTokenHash(
      hashPublicToken(publicToken),
    );
  }

  async respondToChatCommand(input: {
    provider: string;
    externalChannelId: string;
    chatterUserId: string;
    chatterIsModerator: boolean;
    text: string;
  }) {
    const trigger = input.text.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (!trigger?.startsWith("!")) return null;
    const command = await this.repository.findCommandForChannel(
      input.provider,
      input.externalChannelId,
      trigger,
    );
    if (!command || !command.enabled) return null;
    if (
      command.accessLevel === "moderators" &&
      !input.chatterIsModerator
    ) {
      return null;
    }
    if (
      command.accessLevel === "creator" &&
      input.chatterUserId !== input.externalChannelId
    ) {
      return null;
    }
    const accepted = await this.repository.acquireCommandCooldown({
      commandId: command.id,
      channelId: input.externalChannelId,
      chatterUserId: input.chatterUserId,
      now: new Date(),
      channelWindowMs: 1_000,
      userWindowMs: 5_000,
    });
    if (!accepted) return null;
    const state = await this.repository.findLatestOverlayState(
      command.creatorIdentityId,
    );
    return renderTemplate(command.responseTemplate, state);
  }

  private async requirePermission(
    actorUserId: string,
    creatorIdentityId: string,
    permission: CreatorPermission,
  ) {
    const role = await this.repository.resolveRole(
      actorUserId,
      creatorIdentityId,
    );
    if (!role || !can(role, permission)) {
      throw new FeatureForbiddenError();
    }
    return role;
  }
}

const templateVariables = {
  activity: (state: PublicStreamState) => state.activity ?? "не указано",
  pack: (state: PublicStreamState) => state.pack ?? "не выбрана",
  dungeon: (state: PublicStreamState) => state.dungeon ?? "не выбран",
  timer: (state: PublicStreamState) => formatDuration(state.timerSeconds),
  progress: (state: PublicStreamState) =>
    `Пачки ${state.packsDone}/${state.packsTotal}, данжи ${state.dungeonsDone}/${state.dungeonsTotal}`,
  reward_total: (state: PublicStreamState) => String(state.chests),
  server: (state: PublicStreamState) => state.server ?? "не указан",
  player: (state: PublicStreamState) => state.player ?? "не указан",
  time: (state: PublicStreamState) => formatDuration(state.farmTimeSeconds),
} satisfies Record<string, (state: PublicStreamState) => string>;

const variablePattern = /\{([a-z_]+)\}/g;

export function validateTemplate(template: string) {
  if (template.length < 1 || template.length > 450) {
    throw new InvalidTemplateError();
  }
  for (const match of template.matchAll(variablePattern)) {
    if (!match[1] || !(match[1] in templateVariables)) {
      throw new InvalidTemplateError();
    }
  }
}

export function renderTemplate(
  template: string,
  state: PublicStreamState,
) {
  validateTemplate(template);
  return template.replace(variablePattern, (_match, variable: string) => {
    const renderer =
      templateVariables[variable as keyof typeof templateVariables];
    return renderer(state);
  });
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function hashPublicToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export class FeatureForbiddenError extends Error {}
export class FeatureResourceNotFoundError extends Error {}
export class MissingStreamingConnectionError extends Error {}
export class InvalidTemplateError extends Error {}
export class ReservedStreamingCommandError extends Error {}
