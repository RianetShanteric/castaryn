import { z } from "zod";

const SnapshotSchema = z.object({
  generatedAt: z.coerce.date(),
  accounts: z.object({
    total: z.number().int().nonnegative(),
    today: z.number().int().nonnegative(),
    last7Days: z.number().int().nonnegative(),
  }),
  creators: z.object({
    active: z.number().int().nonnegative(),
    inactive: z.number().int().nonnegative(),
    byPlan: z.record(z.string(), z.number().int().nonnegative()),
  }),
  integrations: z.array(
    z.object({
      provider: z.string(),
      connected: z.number().int().nonnegative(),
      ready: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      botAuthorized: z.boolean(),
    }),
  ),
  site: z.object({
    viewsToday: z.number().int().nonnegative(),
    uniqueToday: z.number().int().nonnegative(),
    views7Days: z.number().int().nonnegative(),
    unique7Days: z.number().int().nonnegative(),
    views30Days: z.number().int().nonnegative(),
    unique30Days: z.number().int().nonnegative(),
    responseMs: z.number().int().nonnegative().nullable(),
    online: z.boolean(),
  }),
  system: z.object({
    apiUptimeSeconds: z.number().int().nonnegative(),
    memoryUsedPercent: z.number().nonnegative(),
    diskUsedPercent: z.number().nonnegative(),
    eventWorkerOnline: z.boolean(),
  }),
});

export type OperationsSnapshot = z.infer<typeof SnapshotSchema>;

export async function loadSnapshot(initData: string) {
  if (import.meta.env.DEV && initData === "__preview__") {
    return SnapshotSchema.parse({
      generatedAt: new Date(),
      accounts: { total: 12, today: 2, last7Days: 7 },
      creators: { active: 3, inactive: 1, byPlan: { lifetime: 3, trial: 1 } },
      integrations: [
        {
          provider: "twitch",
          connected: 2,
          ready: 2,
          failed: 0,
          botAuthorized: true,
        },
        {
          provider: "youtube",
          connected: 1,
          ready: 1,
          failed: 0,
          botAuthorized: true,
        },
      ],
      site: {
        viewsToday: 48,
        uniqueToday: 21,
        views7Days: 286,
        unique7Days: 119,
        views30Days: 934,
        unique30Days: 382,
        responseMs: 84,
        online: true,
      },
      system: {
        apiUptimeSeconds: 91342,
        memoryUsedPercent: 57.4,
        diskUsedPercent: 51.2,
        eventWorkerOnline: true,
      },
    });
  }
  const response = await fetch("/tg-api/snapshot", {
    headers: { "x-telegram-init-data": initData },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Сессия Telegram истекла. Закройте и снова откройте приложение."
        : "Не удалось получить данные Castaryn.",
    );
  }
  return SnapshotSchema.parse(await response.json());
}
