import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CreatorAccessService } from "./access-service.js";
import type { AuthenticateRequest } from "./auth.js";
import {
  CreatorAccessRequiredError,
  InvalidOAuthStateError,
  type CreatorPlatformService,
} from "./creator-platform.js";
import { z } from "zod";
import {
  CreatorFeaturesService,
  FeatureForbiddenError,
  FeatureResourceNotFoundError,
  InvalidTemplateError,
  MissingStreamingConnectionError,
  ReservedStreamingCommandError,
} from "./creator-features.js";
import type {
  TwitchChatRuntime,
  TwitchEventSubVerifier,
} from "./twitch-chat.js";
import {
  AdminResourceNotFoundError,
  AdminStreamingConnectionRequiredError,
  type AdminService,
} from "./admin-service.js";
import {
  InvalidTwitchBotOAuthStateError,
  TwitchBotAuthorizationRequiredError,
  type TwitchBotService,
} from "./twitch-bot.js";
import {
  InvalidYoutubeBotOAuthStateError,
  YoutubeBotAuthorizationRequiredError,
  type YoutubeBotService,
} from "./youtube-bot.js";
import type {
  ExternalEventInbox,
  JsonValue,
} from "./event-inbox.js";
import { randomUUID } from "node:crypto";
import {
  AmbiguousViewerError,
  EventsCommandConflictError,
  EventsEffectNotFoundError,
  EventsForbiddenError,
  InsufficientEventBalanceError,
  ViewerNotFoundError,
  type EventsService,
} from "./events.js";
import type { OperationsDashboardService } from "./operations-dashboard.js";
import type { SiteAnalyticsService } from "./site-analytics.js";
import {
  TelegramAuthError,
  verifyTelegramInitData,
} from "./telegram-auth.js";

export type CreatorApiDependencies = {
  accessService: CreatorAccessService;
  authenticate: AuthenticateRequest;
  platformService?: CreatorPlatformService;
  featuresService?: CreatorFeaturesService;
  twitchChatRuntime?: TwitchChatRuntime;
  twitchEventSubVerifier?: TwitchEventSubVerifier;
  adminService?: AdminService;
  authenticateAdmin?: AuthenticateRequest;
  adminAllowedOrigin?: string;
  twitchBotService?: TwitchBotService;
  youtubeBotService?: YoutubeBotService;
  youtubeConfigured?: boolean;
  eventInbox?: ExternalEventInbox;
  eventsService?: EventsService;
  operationsService?: OperationsDashboardService;
  siteAnalyticsService?: SiteAnalyticsService;
  siteAllowedOrigin?: string;
  telegram?: {
    botToken: string;
    adminUserId: number;
    miniAppUrl: URL;
  };
  logger?: boolean;
  trustProxy?: number;
};

export async function buildCreatorApi(
  dependencies: CreatorApiDependencies,
): Promise<FastifyInstance> {
  const trustProxyHops = dependencies.trustProxy ?? 0;
  const app = Fastify({
    logger: dependencies.logger
      ? {
          level: "warn",
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers.set-cookie",
            ],
            censor: "[REDACTED]",
          },
        }
      : false,
    bodyLimit: 64 * 1024,
    requestTimeout: 10_000,
    connectionTimeout: 5_000,
    trustProxy:
      trustProxyHops > 0
        ? (_address, hop) => hop < trustProxyHops
        : false,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet);
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });
  const overlaySseConnectionsByToken = new Map<string, number>();
  const maxOverlaySseConnectionsPerToken = 5;

  // Registered before any route so that every route -- including ones added
  // inside the nested `adminRoutes` plugin below -- is compiled against this
  // handler rather than Fastify's default one. `await`-ing a `.register()`
  // call resolves through Fastify's `ready()`, which can finalize routes
  // registered earlier in this function; setting the handler this early
  // guarantees it is already present by the time that happens.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CreatorAccessRequiredError) {
      return reply.code(403).send({
        error: "creator_access_required",
        message: "Creator access is required",
      });
    }
    if (error instanceof InvalidOAuthStateError) {
      return reply.code(400).send({
        error: "invalid_oauth_state",
        message: "OAuth request expired or was already used",
      });
    }
    if (error instanceof FeatureForbiddenError) {
      return reply.code(403).send({
        error: "forbidden",
        message: "You do not have access to this Creator resource",
      });
    }
    if (error instanceof EventsForbiddenError) {
      return reply.code(403).send({
        error: "forbidden",
        message: "You do not have access to Castaryn Events",
      });
    }
    if (error instanceof InsufficientEventBalanceError) {
      return reply.code(409).send({
        error: "insufficient_balance",
        message: "Balance cannot become negative",
      });
    }
    if (error instanceof ViewerNotFoundError) {
      return reply.code(404).send({
        error: "viewer_not_found",
        message: "No viewer matches that nickname yet",
      });
    }
    if (error instanceof AmbiguousViewerError) {
      return reply.code(409).send({
        error: "ambiguous_viewer",
        message: "Multiple viewers match that nickname",
      });
    }
    if (error instanceof EventsEffectNotFoundError) {
      return reply.code(404).send({
        error: "event_effect_not_found",
        message: "Event effect was not found or is no longer available",
      });
    }
    if (error instanceof EventsCommandConflictError) {
      return reply.code(409).send({
        error: "event_command_conflict",
        message: "Event command is reserved or already used",
      });
    }
    if (error instanceof TelegramAuthError) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Telegram authentication required",
      });
    }
    if (error instanceof FeatureResourceNotFoundError) {
      return reply.code(404).send({
        error: "not_found",
        message: "Creator resource was not found",
      });
    }
    if (error instanceof MissingStreamingConnectionError) {
      return reply.code(409).send({
        error: "streaming_connection_required",
        message: "Connect Twitch before creating commands",
      });
    }
    if (error instanceof InvalidTemplateError || error instanceof z.ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Request is invalid",
      });
    }
    if (error instanceof ReservedStreamingCommandError) {
      return reply.code(409).send({
        error: "reserved_command",
        message: "This command is reserved by Castaryn Events",
      });
    }
    if (error instanceof AdminResourceNotFoundError) {
      return reply.code(404).send({
        error: "not_found",
        message: "Creator account or subscription was not found",
      });
    }
    if (error instanceof AdminStreamingConnectionRequiredError) {
      return reply.code(409).send({
        error: "streaming_connection_required",
        message: "Connect a Twitch channel before granting Creator access",
      });
    }
    if (error instanceof InvalidTwitchBotOAuthStateError) {
      return reply.code(400).send({
        error: "invalid_oauth_state",
        message: "Twitch bot authorization expired or was already used",
      });
    }
    if (error instanceof TwitchBotAuthorizationRequiredError) {
      return reply.code(409).send({
        error: "twitch_bot_authorization_required",
        message: "Authorize the Castaryn Twitch bot before enabling chat",
      });
    }
    if (error instanceof InvalidYoutubeBotOAuthStateError) {
      return reply.code(400).send({
        error: "invalid_oauth_state",
        message: "YouTube bot authorization expired or was already used",
      });
    }
    if (error instanceof YoutubeBotAuthorizationRequiredError) {
      return reply.code(409).send({
        error: "youtube_bot_authorization_required",
        message: "Authorize the Castaryn YouTube bot before enabling chat",
      });
    }
    app.log.error({ err: error }, "Request failed");
    return reply.code(500).send({
      error: "internal_error",
      message: "Request could not be completed",
    });
  });

  const eventAssetRoot = [
    process.env.CASTARYN_EVENTS_ASSET_DIR,
    resolve(process.cwd(), "public", "events"),
    resolve(process.cwd(), "..", "..", "public", "events"),
  ].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  if (!eventAssetRoot) {
    throw new Error("Castaryn Events assets are missing");
  }
  await app.register(fastifyStatic, {
    root: eventAssetRoot,
    prefix: "/events/",
    decorateReply: false,
    immutable: true,
    maxAge: "7d",
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      try {
        const rawBody = Buffer.isBuffer(body)
          ? body
          : Buffer.from(body, "utf8");
        (request as typeof request & { rawBody: Buffer }).rawBody = rawBody;
        done(null, JSON.parse(rawBody.toString("utf8")));
      } catch (error) {
        done(error as Error);
      }
    },
  );

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    if (
      request.url.startsWith("/v1/") ||
      request.url.startsWith("/internal/telegram/")
    ) {
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
    }
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  await app.register(async function siteAnalyticsRoutes(siteScope) {
    if (dependencies.siteAllowedOrigin) {
      siteScope.addHook("onRequest", async (request, reply) => {
        if (request.headers.origin !== dependencies.siteAllowedOrigin) {
          return reply.code(403).send({
            error: "forbidden_origin",
            message: "Site analytics accepts requests from Castaryn only",
          });
        }
        reply.header("access-control-allow-origin", dependencies.siteAllowedOrigin);
        reply.header("access-control-allow-methods", "POST, OPTIONS");
        reply.header("access-control-allow-headers", "content-type");
        reply.header("access-control-max-age", "600");
        reply.header("vary", "Origin");
      });
    }
    siteScope.options("/v1/site/visit", async (_request, reply) =>
      reply.code(204).send(),
    );
    siteScope.post(
      "/v1/site/visit",
      { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (!dependencies.siteAnalyticsService) {
          return reply.code(204).send();
        }
        const body = z
          .object({
            path: z.string().min(1).max(200),
            referrer: z.string().max(2_048).optional(),
          })
          .parse(request.body);
        await dependencies.siteAnalyticsService.record({
          ip: request.ip,
          userAgent:
            typeof request.headers["user-agent"] === "string"
              ? request.headers["user-agent"]
              : "",
          path: body.path,
          referrer: body.referrer,
        });
        return reply.code(204).send();
      },
    );
  });

  await app.register(async function telegramRoutes(telegramScope) {
    if (!dependencies.telegram || !dependencies.operationsService) return;
    telegramScope.addHook("onRequest", async (request, reply) => {
      if (
        request.headers.origin === dependencies.telegram!.miniAppUrl.origin
      ) {
        reply.header(
          "access-control-allow-origin",
          dependencies.telegram!.miniAppUrl.origin,
        );
        reply.header("access-control-allow-methods", "GET, OPTIONS");
        reply.header(
          "access-control-allow-headers",
          "x-telegram-init-data",
        );
        reply.header("access-control-max-age", "300");
        reply.header("vary", "Origin");
      }
    });
    telegramScope.options(
      "/internal/telegram/snapshot",
      async (_request, reply) => reply.code(204).send(),
    );
    telegramScope.get(
      "/internal/telegram/snapshot",
      { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
      async (request) => {
        const initData = request.headers["x-telegram-init-data"];
        if (typeof initData !== "string") {
          throw new TelegramAuthError("Telegram session is missing");
        }
        verifyTelegramInitData({
          initData,
          botToken: dependencies.telegram!.botToken,
          allowedUserId: dependencies.telegram!.adminUserId,
        });
        return dependencies.operationsService!.snapshot();
      },
    );
  });

  app.post(
    "/webhooks/twitch/eventsub",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (request, reply) => {
    if (
      !dependencies.twitchChatRuntime ||
      !dependencies.twitchEventSubVerifier ||
      !dependencies.platformService
    ) {
      return reply.code(404).send();
    }
    const messageId = request.headers["twitch-eventsub-message-id"];
    const timestamp = request.headers["twitch-eventsub-message-timestamp"];
    const signature = request.headers["twitch-eventsub-message-signature"];
    const messageType = request.headers["twitch-eventsub-message-type"];
    const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;
    if (
      typeof messageId !== "string" ||
      typeof timestamp !== "string" ||
      typeof signature !== "string" ||
      typeof messageType !== "string" ||
      !rawBody ||
      !dependencies.twitchEventSubVerifier.verify(
        { messageId, timestamp, signature, messageType },
        rawBody,
      )
    ) {
      return reply.code(403).send();
    }

    const payload = dependencies.twitchChatRuntime.parsePayload(rawBody);
    if (messageType === "webhook_callback_verification") {
      const externalChannelId =
        payload.subscription.condition?.broadcaster_user_id;
      if (externalChannelId) {
        await dependencies.platformService.confirmTwitchEventSub(
          externalChannelId,
        );
      }
      return reply
        .type("text/plain; charset=utf-8")
        .send(payload.challenge ?? "");
    }
    if (messageType === "notification") {
      if (!dependencies.eventInbox) {
        return reply.code(503).send();
      }
      await dependencies.eventInbox.enqueue(
        "twitch",
        messageId,
        messageType,
        JSON.parse(rawBody.toString("utf8")) as JsonValue,
      );
    }
      return reply.code(204).send();
    },
  );

  app.get("/v1/creator/access", async (request, reply) => {
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    const access = await dependencies.accessService.checkCreatorAccess(
      actor.userId,
    );
    return access;
  });

  app.post("/v1/connections/twitch/authorize", async (request, reply) => {
    if (!dependencies.platformService) {
      return reply.code(503).send({
        error: "integration_unavailable",
        message: "Twitch integration is not configured",
      });
    }
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    const authorizeUrl =
      await dependencies.platformService.beginTwitchConnection(
        actor.userId,
      );
    return reply.code(201).send({ authorizeUrl });
  });

  app.get("/v1/connections/twitch/callback", async (request, reply) => {
    if (!dependencies.platformService) {
      return reply.code(503).type("text/plain").send("Integration unavailable");
    }
    const input = z
      .object({
        code: z.string().min(1).max(512),
        state: z.string().min(32).max(256),
      })
      .safeParse(request.query);
    if (!input.success) {
      return reply.code(400).type("text/plain").send("Invalid OAuth callback");
    }
    await dependencies.platformService.finishTwitchConnection(
      input.data.code,
      input.data.state,
    );
    return reply
      .type("text/html; charset=utf-8")
      .send(
        "<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><title>Castaryn</title><body style=\"font-family:system-ui;background:#0b1012;color:#eef7f4;padding:48px\"><h1>Twitch подключён</h1><p>Можно закрыть это окно и вернуться в Castaryn.</p></body></html>",
      );
  });

  app.get("/v1/connections/twitch", async (request, reply) => {
    if (!dependencies.platformService) {
      return reply.code(503).send({
        error: "integration_unavailable",
        message: "Twitch integration is not configured",
      });
    }
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    const connection =
      await dependencies.platformService.getTwitchConnection(actor.userId);
    return { connection };
  });

  app.delete("/v1/connections/twitch", async (request, reply) => {
    if (!dependencies.platformService) {
      return reply.code(503).send({
        error: "integration_unavailable",
        message: "Twitch integration is not configured",
      });
    }
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    await dependencies.platformService.disconnectTwitch(actor.userId);
    return reply.code(204).send();
  });

  app.post("/v1/connections/youtube/authorize", async (request, reply) => {
    if (!dependencies.platformService || !dependencies.youtubeConfigured) {
      return reply.code(503).send({
        error: "integration_unavailable",
        message: "YouTube integration is not configured",
      });
    }
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    const authorizeUrl =
      await dependencies.platformService.beginYoutubeConnection(
        actor.userId,
      );
    return reply.code(201).send({ authorizeUrl });
  });

  app.get("/v1/connections/youtube/callback", async (request, reply) => {
    if (!dependencies.platformService || !dependencies.youtubeConfigured) {
      return reply.code(503).type("text/plain").send("Integration unavailable");
    }
    const input = z
      .object({
        code: z.string().min(1).max(512),
        state: z.string().min(32).max(256),
      })
      .safeParse(request.query);
    if (!input.success) {
      return reply.code(400).type("text/plain").send("Invalid OAuth callback");
    }
    await dependencies.platformService.finishYoutubeConnection(
      input.data.code,
      input.data.state,
    );
    return reply
      .type("text/html; charset=utf-8")
      .send(
        "<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><title>Castaryn</title><body style=\"font-family:system-ui;background:#0b1012;color:#eef7f4;padding:48px\"><h1>YouTube подключён</h1><p>Можно закрыть это окно и вернуться в Castaryn.</p></body></html>",
      );
  });

  app.get("/v1/connections/youtube", async (request, reply) => {
    if (!dependencies.platformService || !dependencies.youtubeConfigured) {
      return reply.code(503).send({
        error: "integration_unavailable",
        message: "YouTube integration is not configured",
      });
    }
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    const connection =
      await dependencies.platformService.getYoutubeConnection(actor.userId);
    return { connection };
  });

  app.delete("/v1/connections/youtube", async (request, reply) => {
    if (!dependencies.platformService || !dependencies.youtubeConfigured) {
      return reply.code(503).send({
        error: "integration_unavailable",
        message: "YouTube integration is not configured",
      });
    }
    const actor = await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
    if (!actor) return;
    await dependencies.platformService.disconnectYoutube(actor.userId);
    return reply.code(204).send();
  });

  const creatorParamsSchema = z.object({
    creatorId: z.string().uuid(),
  });
  const commandParamsSchema = creatorParamsSchema.extend({
    commandId: z.string().uuid(),
  });
  const eventParamsSchema = creatorParamsSchema.extend({
    eventId: z.string().min(1).max(48),
  });

  app.get("/v1/creators/:creatorId/events", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.eventsService) return;
    const params = creatorParamsSchema.parse(request.params);
    return dependencies.eventsService.getProfile(actor.userId, params.creatorId);
  });

  app.put("/v1/creators/:creatorId/events/profile", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.eventsService) return;
    const params = creatorParamsSchema.parse(request.params);
    return dependencies.eventsService.updateProfile(
      actor.userId,
      params.creatorId,
      request.body,
    );
  });

  app.post(
    "/v1/creators/:creatorId/events/stop",
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = creatorParamsSchema.parse(request.params);
      return dependencies.eventsService.stopAllEffects(
        actor.userId,
        params.creatorId,
      );
    },
  );

  app.put(
    "/v1/creators/:creatorId/events/:eventId",
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = eventParamsSchema.parse(request.params);
      return dependencies.eventsService.updateEvent(
        actor.userId,
        params.creatorId,
        params.eventId,
        request.body,
      );
    },
  );

  app.get("/v1/creators/:creatorId/events/balances", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.eventsService) return;
    const params = creatorParamsSchema.parse(request.params);
    const query = z
      .object({
        query: z.string().max(64).optional(),
        cursor: z.string().max(256).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);
    return dependencies.eventsService.listBalances(
      actor.userId,
      params.creatorId,
      query.query ?? null,
      query.cursor ?? null,
      query.limit,
    );
  });

  app.post(
    "/v1/creators/:creatorId/events/balances/adjust",
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = creatorParamsSchema.parse(request.params);
      return dependencies.eventsService.adjustBalance(
        actor.userId,
        params.creatorId,
        request.body,
      );
    },
  );

  app.get(
    "/v1/creators/:creatorId/events/effects",
    { config: { rateLimit: { max: 180, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = creatorParamsSchema.parse(request.params);
      const query = z
        .object({ after: z.string().default("0") })
        .parse(request.query);
      return dependencies.eventsService.listEffects(
        actor.userId,
        params.creatorId,
        query.after,
      );
    },
  );

  app.get(
    "/v1/creators/:creatorId/events/effects/cursor",
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = creatorParamsSchema.parse(request.params);
      return dependencies.eventsService.latestSequence(
        actor.userId,
        params.creatorId,
      );
    },
  );

  app.post(
    "/v1/creators/:creatorId/events/heartbeat",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = creatorParamsSchema.parse(request.params);
      return dependencies.eventsService.heartbeat(
        actor.userId,
        params.creatorId,
        request.body,
      );
    },
  );

  app.post(
    "/v1/creators/:creatorId/events/effects/:effectId/ack",
    async (request, reply) => {
      const actor = await authenticateOrReply(dependencies, request, reply);
      if (!actor || !dependencies.eventsService) return;
      const params = creatorParamsSchema
        .extend({ effectId: z.string().uuid() })
        .parse(request.params);
      await dependencies.eventsService.acknowledge(
        actor.userId,
        params.creatorId,
        params.effectId,
      );
      return reply.code(204).send();
    },
  );

  app.get("/v1/creator/workspaces", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.featuresService) return;
    return dependencies.featuresService.listAccessibleCreators(actor.userId);
  });

  app.get("/v1/creators/:creatorId/commands", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.featuresService) return;
    const params = creatorParamsSchema.parse(request.params);
    return dependencies.featuresService.listCommands(
      actor.userId,
      params.creatorId,
    );
  });

  app.post("/v1/creators/:creatorId/commands", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.featuresService) return;
    const params = creatorParamsSchema.parse(request.params);
    const command = await dependencies.featuresService.createCommand(
      actor.userId,
      params.creatorId,
      request.body,
    );
    return reply.code(201).send(command);
  });

  app.put(
    "/v1/creators/:creatorId/commands/:commandId",
    async (request, reply) => {
      const actor = await authenticateOrReply(
        dependencies,
        request,
        reply,
      );
      if (!actor || !dependencies.featuresService) return;
      const params = commandParamsSchema.parse(request.params);
      return dependencies.featuresService.updateCommand(
        actor.userId,
        params.creatorId,
        params.commandId,
        request.body,
      );
    },
  );

  app.delete(
    "/v1/creators/:creatorId/commands/:commandId",
    async (request, reply) => {
      const actor = await authenticateOrReply(
        dependencies,
        request,
        reply,
      );
      if (!actor || !dependencies.featuresService) return;
      const params = commandParamsSchema.parse(request.params);
      await dependencies.featuresService.deleteCommand(
        actor.userId,
        params.creatorId,
        params.commandId,
      );
      return reply.code(204).send();
    },
  );

  app.post(
    "/v1/creators/:creatorId/commands/preview",
    async (request, reply) => {
      const actor = await authenticateOrReply(
        dependencies,
        request,
        reply,
      );
      if (!actor || !dependencies.featuresService) return;
      const params = creatorParamsSchema.parse(request.params);
      const body = z
        .object({
          responseTemplate: z.string().min(1).max(450),
          state: z.unknown(),
        })
        .parse(request.body);
      return {
        preview: await dependencies.featuresService.previewCommand(
          actor.userId,
          params.creatorId,
          body.responseTemplate,
          body.state,
        ),
      };
    },
  );

  app.put("/v1/creators/:creatorId/overlay", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.featuresService) return;
    const params = creatorParamsSchema.parse(request.params);
    return dependencies.featuresService.saveOverlayConfiguration(
      actor.userId,
      params.creatorId,
      request.body,
    );
  });

  app.get("/v1/creators/:creatorId/overlay", async (request, reply) => {
    const actor = await authenticateOrReply(dependencies, request, reply);
    if (!actor || !dependencies.featuresService) return;
    const params = creatorParamsSchema.parse(request.params);
    return dependencies.featuresService.getOverlayConfiguration(
      actor.userId,
      params.creatorId,
    );
  });

  app.put(
    "/v1/creators/:creatorId/overlay/state",
    { config: { rateLimit: { max: 180, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const actor = await authenticateOrReply(
        dependencies,
        request,
        reply,
      );
      if (!actor || !dependencies.featuresService) return;
      const params = creatorParamsSchema.parse(request.params);
      return dependencies.featuresService.publishOverlayState(
        actor.userId,
        params.creatorId,
        request.body,
      );
    },
  );

  app.get("/overlay/:publicToken/state", async (request, reply) => {
    if (!dependencies.featuresService) return reply.code(404).send();
    const { publicToken } = z
      .object({ publicToken: z.string() })
      .parse(request.params);
    const snapshot =
      await dependencies.featuresService.getPublicOverlay(publicToken);
    if (!snapshot) return reply.code(404).send();
    const { creatorIdentityId: _creatorIdentityId, ...publicSnapshot } =
      snapshot;
    return publicSnapshot;
  });

  app.get(
    "/overlay/:publicToken/effects",
    { config: { rateLimit: { max: 180, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!dependencies.eventsService) return reply.code(404).send();
      const { publicToken } = z
        .object({ publicToken: z.string() })
        .parse(request.params);
      const { after } = z
        .object({ after: z.string().default("0") })
        .parse(request.query);
      const effects = await dependencies.eventsService.listPublicEffects(
        publicToken,
        after,
      );
      if (!effects) return reply.code(404).send();
      return effects;
    },
  );

  app.get(
    "/overlay/:publicToken/effects/cursor",
    async (request, reply) => {
      if (!dependencies.eventsService) return reply.code(404).send();
      const { publicToken } = z
        .object({ publicToken: z.string() })
        .parse(request.params);
      const sequence =
        await dependencies.eventsService.latestPublicSequence(publicToken);
      if (sequence === null) return reply.code(404).send();
      return { sequence };
    },
  );

  app.post(
    "/overlay/:publicToken/heartbeat",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!dependencies.eventsService) return reply.code(404).send();
      const { publicToken } = z
        .object({ publicToken: z.string() })
        .parse(request.params);
      const result = await dependencies.eventsService.heartbeatPublic(
        publicToken,
        request.body,
      );
      if (!result) return reply.code(404).send();
      return result;
    },
  );

  app.post(
    "/overlay/:publicToken/effects/:effectId/ack",
    async (request, reply) => {
      if (!dependencies.eventsService) return reply.code(404).send();
      const { publicToken, effectId } = z
        .object({
          publicToken: z.string(),
          effectId: z.string().uuid(),
        })
        .parse(request.params);
      const acknowledged =
        await dependencies.eventsService.acknowledgePublic(
          publicToken,
          effectId,
        );
      if (!acknowledged) return reply.code(404).send();
      return reply.code(204).send();
    },
  );

  app.get("/overlay/client.js", async (_request, reply) => {
    return reply
      .type("application/javascript; charset=utf-8")
      .header("cache-control", "public, max-age=3600")
      .send(overlayClientScript);
  });

  app.get("/overlay/style.css", async (_request, reply) => {
    return reply
      .type("text/css; charset=utf-8")
      .header("cache-control", "public, max-age=3600")
      .send(overlayStyleSheet);
  });

  app.get("/overlay/:publicToken", async (request, reply) => {
    if (!dependencies.featuresService) return reply.code(404).send();
    const { publicToken } = z
      .object({ publicToken: z.string() })
      .parse(request.params);
    const snapshot =
      await dependencies.featuresService.getPublicOverlay(publicToken);
    if (!snapshot) return reply.code(404).send();
    return reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(
        '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/overlay/style.css"><title>Castaryn Overlay</title></head><body><main id="castaryn-overlay" aria-live="polite"></main><script src="/overlay/client.js" defer></script></body></html>',
      );
  });

  app.get(
    "/overlay/:publicToken/events",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!dependencies.featuresService) return reply.code(404).send();
      const { publicToken } = z
        .object({ publicToken: z.string() })
        .parse(request.params);
      const snapshot =
        await dependencies.featuresService.getPublicOverlay(publicToken);
      if (!snapshot) return reply.code(404).send();

      const activeConnections =
        overlaySseConnectionsByToken.get(publicToken) ?? 0;
      if (activeConnections >= maxOverlaySseConnectionsPerToken) {
        return reply.code(429).send();
      }
      overlaySseConnectionsByToken.set(publicToken, activeConnections + 1);
      const releaseConnection = () => {
        const remaining = (overlaySseConnectionsByToken.get(publicToken) ?? 1) - 1;
        if (remaining <= 0) {
          overlaySseConnectionsByToken.delete(publicToken);
        } else {
          overlaySseConnectionsByToken.set(publicToken, remaining);
        }
      };

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write(`event: ready\ndata: ${snapshot.revision}\n\n`);

      let revision = snapshot.revision;
      let polling = false;
      const poll = async () => {
        if (polling || reply.raw.destroyed) return;
        polling = true;
        try {
          const current =
            await dependencies.featuresService!.getPublicOverlay(publicToken);
          if (!current) {
            reply.raw.end();
            return;
          }
          if (current.revision !== revision) {
            revision = current.revision;
            reply.raw.write(`event: update\ndata: ${revision}\n\n`);
          }
        } catch (error) {
          app.log.warn(
            {
              error:
                error instanceof Error ? error.message : "unknown error",
            },
            "Overlay SSE polling failed",
          );
          if (!reply.raw.destroyed) {
            reply.raw.end();
          }
        } finally {
          polling = false;
        }
      };
      const pollTimer = setInterval(() => void poll(), 1_000);
      const keepAlive = setInterval(
        () => {
          if (!reply.raw.destroyed) {
            reply.raw.write(": keep-alive\n\n");
          }
        },
        15_000,
      );
      request.raw.once("close", () => {
        clearInterval(pollTimer);
        clearInterval(keepAlive);
        releaseConnection();
      });
    },
  );

  // The admin panel is the only caller that needs cross-origin fetch()
  // access, so CORS is registered on this isolated Fastify scope instead of
  // the whole app -- it must not silently widen to /v1 or /overlay routes
  // as the API surface grows.
  await app.register(async function adminRoutes(adminScope) {
    if (dependencies.adminAllowedOrigin) {
      await adminScope.register(cors, {
        origin: dependencies.adminAllowedOrigin,
        methods: ["GET", "POST", "PUT"],
        allowedHeaders: ["authorization", "content-type"],
        credentials: false,
        maxAge: 600,
      });
    }

    adminScope.get("/internal/admin/users", async (request, reply) => {
      const admin = await authenticateAdminOrReply(
        dependencies,
        request,
        reply,
      );
      if (!admin || !dependencies.adminService) return;
      const { query } = z
        .object({ query: z.string() })
        .parse(request.query);
      return dependencies.adminService.search(query);
    });

    adminScope.get(
      "/internal/admin/integrations/twitch-bot",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin || !dependencies.twitchBotService) return;
        return dependencies.twitchBotService.status();
      },
    );

    adminScope.post(
      "/internal/admin/integrations/twitch-bot/authorize",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin || !dependencies.twitchBotService) return;
        return reply.code(201).send({
          authorizeUrl:
            await dependencies.twitchBotService.beginAuthorization(
              admin.subject,
            ),
        });
      },
    );

    adminScope.get(
      "/internal/admin/integrations/youtube-bot",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin) return;
        if (
          !dependencies.youtubeConfigured ||
          !dependencies.youtubeBotService
        ) {
          return {
            configured: false,
            connected: false,
            externalUserId: null,
            scopes: [],
            expiresAt: null,
          };
        }
        return {
          configured: true,
          ...(await dependencies.youtubeBotService.status()),
        };
      },
    );

    adminScope.post(
      "/internal/admin/integrations/youtube-bot/authorize",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin) return;
        if (
          !dependencies.youtubeConfigured ||
          !dependencies.youtubeBotService
        ) {
          return reply.code(503).send({
            error: "integration_not_configured",
            message: "YouTube integration is not configured",
          });
        }
        return reply.code(201).send({
          authorizeUrl:
            await dependencies.youtubeBotService.beginAuthorization(
              admin.subject,
            ),
        });
      },
    );

    adminScope.get(
      "/internal/admin/users/:userId",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin || !dependencies.adminService) return;
        const { userId } = z
          .object({ userId: z.string().uuid() })
          .parse(request.params);
        return dependencies.adminService.getUser(userId);
      },
    );

    adminScope.post(
      "/internal/admin/users/:userId/grant-lifetime",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin || !dependencies.adminService) return;
        const { userId } = z
          .object({ userId: z.string().uuid() })
          .parse(request.params);
        const body = z
          .object({
            source: z.enum(["developer_grant", "gift"]),
            reason: z.string(),
          })
          .parse(request.body);
        return dependencies.adminService.grantLifetime(
          admin.subject,
          userId,
          body.source,
          body.reason,
        );
      },
    );

    adminScope.put(
      "/internal/admin/subscriptions/:subscriptionId",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin || !dependencies.adminService) return;
        const { subscriptionId } = z
          .object({ subscriptionId: z.string().uuid() })
          .parse(request.params);
        const body = z
          .object({
            plan: z.enum(["trial", "monthly", "yearly", "lifetime"]),
            reason: z.string(),
          })
          .parse(request.body);
        await dependencies.adminService.changePlan(
          admin.subject,
          subscriptionId,
          body.plan,
          body.reason,
        );
        return reply.code(204).send();
      },
    );

    adminScope.post(
      "/internal/admin/subscriptions/:subscriptionId/cancel",
      async (request, reply) => {
        const admin = await authenticateAdminOrReply(
          dependencies,
          request,
          reply,
        );
        if (!admin || !dependencies.adminService) return;
        const { subscriptionId } = z
          .object({ subscriptionId: z.string().uuid() })
          .parse(request.params);
        const body = z.object({ reason: z.string() }).parse(request.body);
        await dependencies.adminService.cancel(
          admin.subject,
          subscriptionId,
          body.reason,
        );
        return reply.code(204).send();
      },
    );
  });

  // Twitch's OAuth redirect is a top-level browser navigation, not an XHR
  // from the admin SPA, so it does not need (and must not get) CORS.
  app.get(
    "/internal/integrations/twitch-bot/callback",
    async (request, reply) => {
      if (!dependencies.twitchBotService) {
        return reply.code(404).send();
      }
      const input = z
        .object({
          code: z.string().min(1).max(512),
          state: z.string().min(32).max(256),
        })
        .safeParse(request.query);
      if (!input.success) {
        return reply.code(400).type("text/plain").send("Invalid OAuth callback");
      }
      await dependencies.twitchBotService.finishAuthorization(
        input.data.code,
        input.data.state,
      );
      return reply
        .type("text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .send(
          '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Castaryn Control</title><body style="font-family:system-ui;background:#0b1012;color:#eef7f4;padding:48px"><h1>Castaryn Bot подключён</h1><p>Закройте окно и вернитесь в Castaryn Control.</p></body></html>',
        );
    },
  );

  app.get(
    "/internal/integrations/youtube-bot/callback",
    async (request, reply) => {
      if (!dependencies.youtubeBotService) {
        return reply.code(404).send();
      }
      const input = z
        .object({
          code: z.string().min(1).max(512),
          state: z.string().min(32).max(256),
        })
        .safeParse(request.query);
      if (!input.success) {
        return reply.code(400).type("text/plain").send("Invalid OAuth callback");
      }
      await dependencies.youtubeBotService.finishAuthorization(
        input.data.code,
        input.data.state,
      );
      return reply
        .type("text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .send(
          '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Castaryn Control</title><body style="font-family:system-ui;background:#0b1012;color:#eef7f4;padding:48px"><h1>Castaryn Bot подключён</h1><p>Закройте окно и вернитесь в Castaryn Control.</p></body></html>',
        );
    },
  );

  return app;
}

export const overlayClientScript = String.raw`
(() => {
  const root = document.getElementById("castaryn-overlay");
  const effectRoot = document.createElement("div");
  effectRoot.id = "castaryn-event-effect";
  document.body.append(effectRoot);
  const token = location.pathname.split("/").filter(Boolean).at(-1);
  const consumerId =
    sessionStorage.getItem("castaryn-overlay-consumer") ||
    sessionStorage.getItem("elyvo-overlay-consumer") ||
    (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  sessionStorage.setItem("castaryn-overlay-consumer", consumerId);
  sessionStorage.removeItem("elyvo-overlay-consumer");
  let effectCursor = "0";
  let effectsInitialized = false;
  let effectQueue = Promise.resolve();
  let controlRevision = null;
  let effectGeneration = 0;
  let activeTimer = null;
  let activeResolve = null;
  const stopEffects = () => {
    effectGeneration += 1;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = null;
    if (activeResolve) activeResolve();
    activeResolve = null;
    effectQueue = Promise.resolve();
    document.body.className = "";
    effectRoot.className = "";
    effectRoot.replaceChildren();
  };
  const duration = (value) => {
    const safe = Math.max(0, Math.floor(value || 0));
    return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  };
  const add = (tag, className, value) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    root.append(node);
  };
  const render = ({ configuration, state }) => {
    root.replaceChildren();
    const fields = new Set(configuration.visibleFields);
    if (fields.has("activity")) add("span", "activity", state.activity || "Perfect World PvE");
    if (fields.has("dungeon")) add("strong", "dungeon", state.dungeon || "Данж не выбран");
    if (fields.has("next_dungeon") && state.nextDungeon) add("span", "next-dungeon", "Дальше: " + state.nextDungeon);
    if (fields.has("daily_quest") && state.dailyQuest) add("span", "daily-quest", "Ежа: " + state.dailyQuest);
    const context = document.createElement("div");
    context.className = "context";
    if (fields.has("pack")) {
      const pack = document.createElement("span");
      pack.textContent = state.pack || "Пачка не выбрана";
      context.append(pack);
    }
    if (fields.has("timer")) {
      const timer = document.createElement("span");
      timer.textContent = duration(state.timerSeconds);
      context.append(timer);
    }
    if (context.childElementCount) root.append(context);
    if (fields.has("progress")) {
      add("p", "progress", "Пачки " + state.packsDone + "/" + state.packsTotal + " · Данжи " + state.dungeonsDone + "/" + state.dungeonsTotal);
    }
    if (fields.has("chests")) add("b", "chests", state.chests + " сундуков");
    if (fields.has("inventory_chests")) add("b", "inventory-chests", "В инвентаре: " + state.inventoryChests);
    if (fields.has("farm_time")) add("span", "farm-time", "Фарм " + duration(state.farmTimeSeconds));
    if (fields.has("server") && state.server) add("span", "server", state.server);
  };
  const refresh = async () => {
    const response = await fetch("/overlay/" + encodeURIComponent(token) + "/state", {
      cache: "no-store",
      credentials: "omit"
    });
    if (response.ok) render(await response.json());
  };
  const acknowledgeEffect = async (effectId) => {
    const delays = [0, 250, 750, 1500, 2500];
    for (const delay of delays) {
      if (delay) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      try {
        const response = await fetch(
          "/overlay/" + encodeURIComponent(token) + "/effects/" +
            encodeURIComponent(effectId) + "/ack",
          { method: "POST", credentials: "omit" },
        );
        if (response.ok) return true;
        if (response.status === 404) return false;
      } catch {}
    }
    return false;
  };
  const effectCopy = {
    mouse_block: "МЫШЬ ЗАБЛОКИРОВАНА НА ПК СТРИМЕРА",
    keyboard_block: "КЛАВИАТУРА ЗАБЛОКИРОВАНА НА ПК СТРИМЕРА",
    key_shuffle: "КЛАВИШИ ПЕРЕМЕШАНЫ НА ПК СТРИМЕРА",
    lag: "ВВОД МЫШИ ЗАДЕРЖАН НА ПК СТРИМЕРА",
    mouse_invert: "МЫШЬ ИНВЕРТИРОВАНА НА ПК СТРИМЕРА",
  };
  const memes = [
    "ЧАТ АТАКУЕТ",
    "МЫ ВСЁ ВИДИМ",
    "ВНИМАНИЕ! АКТИВИРОВАН ХАОС",
    "НЕ ПОВЕЗЛО",
    "ЗРИТЕЛЬ НАЖАЛ КНОПКУ ХАОСА",
  ];
  const screamerImages = [
    "/events/screamers/screamer-1.webp",
    "/events/screamers/screamer-2.webp",
    "/events/screamers/screamer-3.webp",
    "/events/screamers/screamer-4.webp",
    "/events/screamers/screamer-5.webp",
  ];
  const assetIndex = (value) =>
    Number.isInteger(value) && value >= 1 && value <= 5 ? value - 1 : null;
  const showEffect = async (event) => {
    const generation = effectGeneration;
    if (!(await acknowledgeEffect(event.id))) return;
    if (generation !== effectGeneration) return;
    const effect = event.effect;
    const durationMs = Math.max(1000, effect.durationSeconds * 1000);
    if (effect.kind === "sound") {
      await new Promise((resolve) => {
        activeResolve = resolve;
        activeTimer = setTimeout(resolve, durationMs);
      });
      activeResolve = null;
      activeTimer = null;
      return;
    }
    effectRoot.className = "event-effect event-effect--" + effect.kind;
    effectRoot.replaceChildren();
    const card = document.createElement("div");
    card.className = "event-effect__card";
    let visual = document.createElement("strong");
    if (effect.kind === "screamer") {
      visual = document.createElement("img");
      visual.className = "event-effect__screamer";
      visual.alt = "";
      visual.src = screamerImages[
        assetIndex(effect.parameters && effect.parameters.visualAsset) ??
          Math.floor(Math.random() * screamerImages.length)
      ];
    } else if (effect.kind === "meme") {
      visual.textContent = memes[
        assetIndex(effect.parameters && effect.parameters.memeAsset) ??
          Math.floor(Math.random() * memes.length)
      ];
    } else if (effect.kind === "darkness") {
      visual.textContent = "ТЬМА";
    } else if (effect.kind === "rotate") {
      visual.textContent = "МИР ПЕРЕВЕРНУЛСЯ";
    } else {
      visual.textContent = effectCopy[effect.kind] || "CASTARYN EVENT";
    }
    if (
      effect.kind !== "screamer" &&
      effect.kind !== "meme" &&
      effect.parameters &&
      typeof effect.parameters.displayName === "string" &&
      effect.parameters.displayName.trim()
    ) {
      visual.textContent = effect.parameters.displayName;
    }
    const author = document.createElement("span");
    author.textContent = "Активировал " + event.viewerName;
    card.append(visual, author);
    effectRoot.append(card);
    document.body.classList.add("event-active", "event-" + effect.kind);
    await new Promise((resolve) => {
      activeResolve = resolve;
      activeTimer = setTimeout(resolve, durationMs);
    });
    activeResolve = null;
    activeTimer = null;
    if (generation !== effectGeneration) return;
    document.body.className = "";
    effectRoot.className = "";
    effectRoot.replaceChildren();
  };
  const heartbeat = async () => {
    const response = await fetch(
      "/overlay/" + encodeURIComponent(token) + "/heartbeat",
      {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumerId }),
      },
    );
    if (!response.ok) return;
    const state = await response.json();
    if (controlRevision !== null && state.controlRevision !== controlRevision) {
      stopEffects();
      const cursorResponse = await fetch(
        "/overlay/" + encodeURIComponent(token) + "/effects/cursor",
        { cache: "no-store", credentials: "omit" },
      );
      if (cursorResponse.ok) {
        effectCursor = (await cursorResponse.json()).sequence;
      }
    }
    controlRevision = state.controlRevision;
  };
  const initializeEffects = async () => {
    const response = await fetch(
      "/overlay/" + encodeURIComponent(token) + "/effects/cursor",
      { cache: "no-store", credentials: "omit" },
    );
    if (response.ok) effectCursor = (await response.json()).sequence;
    await heartbeat();
    effectsInitialized = true;
  };
  const pollEffects = async () => {
    if (!effectsInitialized) return;
    const response = await fetch(
      "/overlay/" + encodeURIComponent(token) + "/effects?after=" +
        encodeURIComponent(effectCursor),
      { cache: "no-store", credentials: "omit" },
    );
    if (!response.ok) return;
    const effects = await response.json();
    for (const effect of effects) {
      effectCursor = effect.sequence;
      const queuedGeneration = effectGeneration;
      effectQueue = effectQueue.then(() => {
        if (queuedGeneration !== effectGeneration) return;
        return showEffect(effect);
      });
    }
  };
  refresh().catch(() => {});
  initializeEffects()
    .then(() => pollEffects())
    .catch(() => {});
  setInterval(() => heartbeat().catch(() => {}), 3_000);
  setInterval(() => pollEffects().catch(() => {}), 750);
  const events = new EventSource("/overlay/" + encodeURIComponent(token) + "/events");
  events.addEventListener("update", () => refresh().catch(() => {}));
})();
`;

const overlayStyleSheet = `
:root{font-family:"Segoe UI Variable","Segoe UI",sans-serif;color:#edf7f4}
*{box-sizing:border-box}
html,body{margin:0;background:transparent;overflow:hidden}
#castaryn-overlay{width:max-content;min-width:300px;display:grid;gap:7px;padding:18px 20px;border:1px solid rgba(126,160,153,.24);border-radius:14px;background:linear-gradient(145deg,rgba(23,33,36,.96),rgba(9,14,16,.96));box-shadow:0 20px 60px rgba(0,0,0,.34)}
.activity{color:#45d2ad;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.dungeon{font-size:21px;letter-spacing:-.035em}
.context{display:flex;gap:13px;color:#b1c0bd;font-size:11px}
.progress{margin:7px 0 0;color:#82938f;font-size:11px}
.chests{font-size:12px}
.farm-time,.server{color:#82938f;font-size:10px}
#castaryn-event-effect{pointer-events:none}
.event-effect{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;overflow:hidden}
.event-effect__card{display:grid;place-items:center;gap:18px;text-align:center;text-transform:uppercase;text-shadow:0 6px 30px #000}
.event-effect__card strong{max-width:90vw;color:#fff;font-size:clamp(48px,12vw,180px);font-weight:950;line-height:.9;letter-spacing:-.06em}
.event-effect__card span{padding:8px 14px;border:1px solid rgba(255,255,255,.3);border-radius:999px;background:rgba(0,0,0,.65);color:#fff;font-size:16px}
.event-effect--screamer{background:radial-gradient(circle,#8b1111 0,#090000 70%);animation:flash .12s steps(2) infinite}
.event-effect--screamer strong{font-size:42vh;filter:drop-shadow(0 0 40px #f00)}
.event-effect__screamer{width:min(68vh,68vw);max-height:70vh;border-radius:18%;filter:drop-shadow(0 0 40px #f00)}
.event-effect--darkness{background:rgba(0,0,0,.93)}
.event-effect--rotate{background:rgba(5,8,10,.75)}
.event-effect--mouse_block,.event-effect--keyboard_block,.event-effect--key_shuffle,.event-effect--lag,.event-effect--mouse_invert{background:repeating-linear-gradient(0deg,rgba(2,9,12,.9) 0 2px,rgba(12,35,37,.9) 3px 4px)}
.event-shake{animation:shake .08s linear infinite}
.event-lag #castaryn-overlay{animation:lag .8s steps(2) infinite}
@keyframes flash{50%{filter:invert(1)}}
@keyframes shake{0%{transform:translate(-8px,4px) rotate(-1deg)}50%{transform:translate(9px,-5px) rotate(1deg)}100%{transform:translate(-3px,7px)}}
@keyframes lag{50%{transform:translateX(28px);opacity:.55}}
`;

async function authenticateAdminOrReply(
  dependencies: CreatorApiDependencies,
  request: {
    headers: { authorization?: string };
  },
  reply: {
    code: (statusCode: number) => {
      send: (payload: unknown) => unknown;
    };
  },
) {
  if (!dependencies.adminService || !dependencies.authenticateAdmin) {
    reply.code(404).send(undefined);
    return null;
  }
  try {
    return await dependencies.authenticateAdmin(
      request.headers.authorization,
    );
  } catch {
    reply.code(401).send({
      error: "unauthorized",
      message: "Administrator authentication required",
    });
    return null;
  }
}

async function authenticateOrReply(
  dependencies: CreatorApiDependencies,
  request: {
    headers: { authorization?: string };
  },
  reply: {
    code: (statusCode: number) => {
      send: (payload: unknown) => unknown;
    };
  },
) {
  if (!dependencies.featuresService) {
    reply.code(503).send({
      error: "creator_features_unavailable",
      message: "Creator features are not configured",
    });
    return null;
  }
  try {
    return await authenticateAccountOrReply(
      dependencies,
      request,
      reply,
    );
  } catch {
    return null;
  }
}

async function authenticateAccountOrReply(
  dependencies: CreatorApiDependencies,
  request: {
    headers: { authorization?: string };
  },
  reply: {
    code: (statusCode: number) => {
      send: (payload: unknown) => unknown;
    };
  },
) {
  if (!dependencies.platformService) {
    reply.code(503).send({
      error: "creator_platform_unavailable",
      message: "Creator platform is not configured",
    });
    return null;
  }
  try {
    const identity = await dependencies.authenticate(
      request.headers.authorization,
    );
    const userId = await dependencies.platformService.ensureAccount({
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified,
    });
    return { userId, email: identity.email };
  } catch {
    reply.code(401).send({
      error: "unauthorized",
      message: "Authentication required",
    });
    return null;
  }
}
