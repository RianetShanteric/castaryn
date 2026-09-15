import postgres from "postgres";
import { readConfig } from "./config.js";
import { OperationsDashboardService } from "./operations-dashboard.js";
import {
  PostgresOperationsRepository,
  PostgresTelegramAlertRepository,
} from "./postgres-operations.js";
import {
  TelegramBotClient,
  TelegramOperationsRuntime,
} from "./telegram-bot.js";

const config = readConfig();
if (!config.telegram) {
  throw new Error("Telegram integration is not configured");
}

const sql = postgres(config.databaseUrl, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl:
    config.environment === "production"
      ? { rejectUnauthorized: true }
      : false,
});
const migrations = await sql<Array<{ count: number }>>`
  select count(*)::int as count
  from creator_schema_migrations
`;
if ((migrations[0]?.count ?? 0) < 15) {
  await sql.end({ timeout: 5 });
  throw new Error(
    "Creator database migrations are not applied; run the migration command first",
  );
}

const client = new TelegramBotClient(config.telegram.botToken);
const dashboard = new OperationsDashboardService(
  new PostgresOperationsRepository(sql),
  config.siteUrl,
);
const runtime = new TelegramOperationsRuntime(
  client,
  dashboard,
  new PostgresTelegramAlertRepository(sql),
  config.telegram.adminUserId,
  config.telegram.miniAppUrl,
  config.apiHealthUrl,
  config.siteUrl,
);

await runtime.configure();
await runtime.checkAndNotify();

let checking = false;
const checkTimer = setInterval(() => {
  if (checking) return;
  checking = true;
  void runtime
    .checkAndNotify()
    .catch((error) => {
      console.error(
        "Telegram monitoring failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    })
    .finally(() => {
      checking = false;
    });
}, 60_000);

const shutdownController = new AbortController();
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(checkTimer);
  shutdownController.abort();
  await sql.end({ timeout: 5 });
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

while (!stopping) {
  try {
    await runtime.poll(
      AbortSignal.any([
        shutdownController.signal,
        AbortSignal.timeout(30_000),
      ]),
    );
  } catch (error) {
    if (stopping) break;
    console.error(
      "Telegram polling failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
