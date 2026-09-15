import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CREATOR_DATABASE_URL: z.string().url(),
  CREATOR_AUTH_JWKS_URL: z.string().url(),
  CREATOR_AUTH_ISSUER: z.string().min(1),
  CREATOR_AUTH_AUDIENCE: z.string().min(1),
  CREATOR_REQUIRE_VERIFIED_EMAIL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ADMIN_AUTH_JWKS_URL: z.string().url(),
  ADMIN_AUTH_ISSUER: z.string().min(1),
  ADMIN_AUTH_AUDIENCE: z.string().min(1),
  ADMIN_ALLOWED_SUBJECTS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((subject) => subject.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(256)).min(1)),
  ADMIN_REQUIRE_MFA: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ADMIN_ALLOWED_ORIGIN: z.string().url(),
  CREATOR_ENCRYPTION_KEY: z.string().min(1),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_REDIRECT_URI: z.string().url(),
  TWITCH_BOT_REDIRECT_URI: z.string().url(),
  TWITCH_BOT_USER_ID: z.string().min(1),
  TWITCH_EVENTSUB_CALLBACK_URL: z.string().url(),
  TWITCH_EVENTSUB_SECRET: z.string().min(10).max(100),
  YOUTUBE_CLIENT_ID: z.string().min(1).optional(),
  YOUTUBE_CLIENT_SECRET: z.string().min(1).optional(),
  YOUTUBE_REDIRECT_URI: z.string().url().optional(),
  YOUTUBE_BOT_REDIRECT_URI: z.string().url().optional(),
  YOUTUBE_BOT_CHANNEL_ID: z.string().min(1).optional(),
  YOUTUBE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(60_000)
    .default(30_000),
  CREATOR_HOST: z.string().default("127.0.0.1"),
  CREATOR_PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  CREATOR_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  SITE_ANALYTICS_SECRET: z.string().min(32).optional(),
  CASTARYN_SITE_URL: z.string().url().default("https://castaryn.ru/"),
  CASTARYN_API_HEALTH_URL: z
    .string()
    .url()
    .default("https://api.castaryn.ru/healthz"),
  TELEGRAM_BOT_TOKEN: z.string().min(30).optional(),
  TELEGRAM_ADMIN_USER_ID: z
    .string()
    .regex(/^[1-9]\d{4,19}$/)
    .optional(),
  TELEGRAM_MINI_APP_URL: z.string().url().optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production") {
    const secureUrlFields = [
      "CREATOR_AUTH_JWKS_URL",
      "CREATOR_AUTH_ISSUER",
      "ADMIN_AUTH_JWKS_URL",
      "ADMIN_AUTH_ISSUER",
      "ADMIN_ALLOWED_ORIGIN",
      "TWITCH_REDIRECT_URI",
      "TWITCH_BOT_REDIRECT_URI",
      "TWITCH_EVENTSUB_CALLBACK_URL",
      "YOUTUBE_REDIRECT_URI",
      "YOUTUBE_BOT_REDIRECT_URI",
      "CASTARYN_SITE_URL",
      "CASTARYN_API_HEALTH_URL",
      "TELEGRAM_MINI_APP_URL",
    ] as const;
    for (const field of secureUrlFields) {
      const candidate = value[field];
      if (!candidate) continue;
      try {
        if (new URL(candidate).protocol === "https:") continue;
      } catch {
        // The field-level URL validation will report malformed URLs too.
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} must use HTTPS in production`,
      });
    }
  }

  // YouTube is optional (this integration can be left unconfigured entirely
  // while Twitch keeps working), but a half-configured YouTube is worse
  // than none -- fail loudly at startup instead of at first use.
  const youtubeFields = [
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "YOUTUBE_REDIRECT_URI",
    "YOUTUBE_BOT_REDIRECT_URI",
    "YOUTUBE_BOT_CHANNEL_ID",
  ] as const;
  const present = youtubeFields.filter((field) => value[field] !== undefined);
  if (present.length > 0 && present.length < youtubeFields.length) {
    const missing = youtubeFields.filter((field) => value[field] === undefined);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `YouTube integration is partially configured; also set: ${missing.join(", ")}`,
    });
  }
  const telegramFields = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ADMIN_USER_ID",
    "TELEGRAM_MINI_APP_URL",
  ] as const;
  const telegramPresent = telegramFields.filter(
    (field) => value[field] !== undefined,
  );
  if (
    telegramPresent.length > 0 &&
    telegramPresent.length < telegramFields.length
  ) {
    const missing = telegramFields.filter(
      (field) => value[field] === undefined,
    );
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Telegram integration is partially configured; also set: ${missing.join(", ")}`,
    });
  }
});

export type CreatorApiConfig = {
  environment: "development" | "test" | "production";
  databaseUrl: string;
  authJwksUrl: URL;
  authIssuer: string;
  authAudience: string;
  creatorRequireVerifiedEmail: boolean;
  adminAuthJwksUrl: URL;
  adminAuthIssuer: string;
  adminAuthAudience: string;
  adminAllowedSubjects: string[];
  adminRequireMfa: boolean;
  adminAllowedOrigin: string;
  encryptionKey: string;
  twitchClientId: string;
  twitchClientSecret: string;
  twitchRedirectUri: string;
  twitchBotRedirectUri: string;
  twitchBotUserId: string;
  twitchEventSubCallbackUrl: string;
  twitchEventSubSecret: string;
  youtube: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    botRedirectUri: string;
    botChannelId: string;
  } | null;
  youtubePollIntervalMs: number;
  host: string;
  port: number;
  trustProxyHops: number;
  siteAnalyticsSecret: string | null;
  siteUrl: URL;
  apiHealthUrl: URL;
  telegram: {
    botToken: string;
    adminUserId: number;
    miniAppUrl: URL;
  } | null;
};

export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CreatorApiConfig {
  const parsed = ConfigSchema.parse(environment);

  return {
    environment: parsed.NODE_ENV,
    databaseUrl: parsed.CREATOR_DATABASE_URL,
    authJwksUrl: new URL(parsed.CREATOR_AUTH_JWKS_URL),
    authIssuer: parsed.CREATOR_AUTH_ISSUER,
    authAudience: parsed.CREATOR_AUTH_AUDIENCE,
    creatorRequireVerifiedEmail: parsed.CREATOR_REQUIRE_VERIFIED_EMAIL,
    adminAuthJwksUrl: new URL(parsed.ADMIN_AUTH_JWKS_URL),
    adminAuthIssuer: parsed.ADMIN_AUTH_ISSUER,
    adminAuthAudience: parsed.ADMIN_AUTH_AUDIENCE,
    adminAllowedSubjects: parsed.ADMIN_ALLOWED_SUBJECTS,
    adminRequireMfa: parsed.ADMIN_REQUIRE_MFA,
    adminAllowedOrigin: new URL(parsed.ADMIN_ALLOWED_ORIGIN).origin,
    encryptionKey: parsed.CREATOR_ENCRYPTION_KEY,
    twitchClientId: parsed.TWITCH_CLIENT_ID,
    twitchClientSecret: parsed.TWITCH_CLIENT_SECRET,
    twitchRedirectUri: parsed.TWITCH_REDIRECT_URI,
    twitchBotRedirectUri: parsed.TWITCH_BOT_REDIRECT_URI,
    twitchBotUserId: parsed.TWITCH_BOT_USER_ID,
    twitchEventSubCallbackUrl: parsed.TWITCH_EVENTSUB_CALLBACK_URL,
    twitchEventSubSecret: parsed.TWITCH_EVENTSUB_SECRET,
    youtube:
      parsed.YOUTUBE_CLIENT_ID &&
      parsed.YOUTUBE_CLIENT_SECRET &&
      parsed.YOUTUBE_REDIRECT_URI &&
      parsed.YOUTUBE_BOT_REDIRECT_URI &&
      parsed.YOUTUBE_BOT_CHANNEL_ID
        ? {
            clientId: parsed.YOUTUBE_CLIENT_ID,
            clientSecret: parsed.YOUTUBE_CLIENT_SECRET,
            redirectUri: parsed.YOUTUBE_REDIRECT_URI,
            botRedirectUri: parsed.YOUTUBE_BOT_REDIRECT_URI,
            botChannelId: parsed.YOUTUBE_BOT_CHANNEL_ID,
          }
        : null,
    youtubePollIntervalMs: parsed.YOUTUBE_POLL_INTERVAL_MS,
    host: parsed.CREATOR_HOST,
    port: parsed.CREATOR_PORT,
    trustProxyHops: parsed.CREATOR_TRUST_PROXY_HOPS,
    siteAnalyticsSecret: parsed.SITE_ANALYTICS_SECRET ?? null,
    siteUrl: new URL(parsed.CASTARYN_SITE_URL),
    apiHealthUrl: new URL(parsed.CASTARYN_API_HEALTH_URL),
    telegram:
      parsed.TELEGRAM_BOT_TOKEN &&
      parsed.TELEGRAM_ADMIN_USER_ID &&
      parsed.TELEGRAM_MINI_APP_URL
        ? {
            botToken: parsed.TELEGRAM_BOT_TOKEN,
            adminUserId: Number(parsed.TELEGRAM_ADMIN_USER_ID),
            miniAppUrl: new URL(parsed.TELEGRAM_MINI_APP_URL),
          }
        : null,
  };
}
