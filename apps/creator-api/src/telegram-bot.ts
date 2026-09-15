import { request } from "node:https";
import { connect } from "node:tls";
import type { OperationsDashboardService } from "./operations-dashboard.js";

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number };
    from?: { id: number };
  };
};

type TelegramResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

export class TelegramApiError extends Error {}

export class TelegramBotClient {
  private readonly baseUrl: string;

  constructor(
    botToken: string,
    private readonly fetcher?: typeof fetch,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async getUpdates(offset: number, signal?: AbortSignal) {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"],
    }, signal);
  }

  async sendMessage(chatId: number, text: string, miniAppUrl?: URL) {
    await this.call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(miniAppUrl
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Открыть Castaryn Control",
                    web_app: { url: miniAppUrl.toString() },
                  },
                ],
              ],
            },
          }
        : {}),
    });
  }

  async configureMenu(miniAppUrl: URL) {
    await this.call("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "Control",
        web_app: { url: miniAppUrl.toString() },
      },
    });
    await this.call("setMyCommands", {
      scope: { type: "all_private_chats" },
      commands: [
        { command: "dashboard", description: "Открыть Castaryn Control" },
        { command: "status", description: "Состояние сервисов" },
        { command: "summary", description: "Краткая сводка" },
        { command: "users", description: "Аккаунты Castaryn" },
        { command: "creators", description: "Creator-доступы" },
        { command: "integrations", description: "Стриминговые интеграции" },
        { command: "site", description: "Посещения и доступность сайта" },
      ],
    });
  }

  private async call<T = unknown>(
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const result = this.fetcher
      ? await fetchTelegram<T>(this.fetcher, url, body, signal)
      : await postTelegramOverIpv4<T>(url, body, signal);
    if (!result.ok || !result.payload.ok) {
      throw new TelegramApiError(
        result.payload.description ?? `Telegram ${method} failed`,
      );
    }
    return result.payload.result;
  }
}

async function fetchTelegram<T>(
  fetcher: typeof fetch,
  url: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return {
    ok: response.ok,
    payload: (await response.json()) as TelegramResponse<T>,
  };
}

function postTelegramOverIpv4<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; payload: TelegramResponse<T> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const outgoing = request(
      url,
      {
        method: "POST",
        family: 4,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
        signal,
        timeout: 35_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_048_576) {
            outgoing.destroy(new TelegramApiError("Telegram response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          try {
            resolve({
              ok:
                response.statusCode !== undefined &&
                response.statusCode >= 200 &&
                response.statusCode < 300,
              payload: JSON.parse(
                Buffer.concat(chunks).toString("utf8"),
              ) as TelegramResponse<T>,
            });
          } catch {
            reject(new TelegramApiError("Telegram returned an invalid response"));
          }
        });
      },
    );
    outgoing.once("timeout", () =>
      outgoing.destroy(new TelegramApiError("Telegram request timed out")),
    );
    outgoing.once("error", reject);
    outgoing.end(payload);
  });
}

export interface TelegramAlertRepository {
  changeAlertState(input: {
    key: string;
    active: boolean;
    details: Record<string, string | number | boolean | null>;
    now: Date;
  }): Promise<"activated" | "recovered" | "unchanged">;
}

export class TelegramOperationsRuntime {
  private updateOffset = 0;

  constructor(
    private readonly client: TelegramBotClient,
    private readonly dashboard: OperationsDashboardService,
    private readonly alertRepository: TelegramAlertRepository,
    private readonly adminUserId: number,
    private readonly miniAppUrl: URL,
    private readonly apiHealthUrl: URL,
    private readonly siteUrl: URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async configure() {
    await this.client.configureMenu(this.miniAppUrl);
  }

  async poll(signal?: AbortSignal) {
    const updates = await this.client.getUpdates(this.updateOffset, signal);
    for (const update of updates) {
      this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
      const senderId = update.message?.from?.id;
      const chatId = update.message?.chat.id;
      if (!chatId || senderId !== this.adminUserId) continue;
      const command = update.message?.text?.trim().split(/\s+/, 1)[0];
      if (command === "/start" || command === "/dashboard") {
        await this.client.sendMessage(
          chatId,
          "Castaryn Control готов. Статистика и состояние инфраструктуры доступны в защищённом Mini App.",
          this.miniAppUrl,
        );
        continue;
      }
      if (
        command === "/status" ||
        command === "/summary" ||
        command === "/users" ||
        command === "/creators" ||
        command === "/integrations" ||
        command === "/site"
      ) {
        const snapshot = await this.dashboard.snapshot();
        await this.client.sendMessage(
          chatId,
          commandText(command, snapshot),
          this.miniAppUrl,
        );
      }
    }
  }

  async checkAndNotify(now = new Date()) {
    const [snapshot, apiProbe, certificateDays] = await Promise.all([
      this.dashboard.snapshot(now),
      probe(this.fetcher, this.apiHealthUrl),
      certificateDaysRemaining(this.siteUrl),
    ]);
    const checks: Array<{
      key: string;
      active: boolean;
      problem: string;
      recovered: string;
      details: Record<string, string | number | boolean | null>;
    }> = [
      {
        key: "site_offline",
        active: !snapshot.site.online,
        problem: "Сайт Castaryn недоступен.",
        recovered: "Сайт Castaryn снова доступен.",
        details: { responseMs: snapshot.site.responseMs },
      },
      {
        key: "api_offline",
        active: !apiProbe,
        problem: "Creator API не отвечает на health check.",
        recovered: "Creator API снова отвечает.",
        details: {},
      },
      {
        key: "event_worker_offline",
        active: !snapshot.system.eventWorkerOnline,
        problem: "Creator worker не присылал heartbeat более двух минут.",
        recovered: "Creator worker снова работает.",
        details: {},
      },
      {
        key: "disk_pressure",
        active: snapshot.system.diskUsedPercent >= 85,
        problem: `Диск заполнен на ${snapshot.system.diskUsedPercent}%.`,
        recovered: `Заполнение диска вернулось к ${snapshot.system.diskUsedPercent}%.`,
        details: { usedPercent: snapshot.system.diskUsedPercent },
      },
      {
        key: "memory_pressure",
        active: snapshot.system.memoryUsedPercent >= 90,
        problem: `Использование памяти достигло ${snapshot.system.memoryUsedPercent}%.`,
        recovered: `Использование памяти снизилось до ${snapshot.system.memoryUsedPercent}%.`,
        details: { usedPercent: snapshot.system.memoryUsedPercent },
      },
      {
        key: "certificate_expiring",
        active: certificateDays !== null && certificateDays <= 14,
        problem: `Сертификат castaryn.ru истекает через ${certificateDays ?? "?"} дн.`,
        recovered: "Срок действия сертификата снова в норме.",
        details: { daysRemaining: certificateDays },
      },
    ];

    for (const check of checks) {
      const transition = await this.alertRepository.changeAlertState({
        key: check.key,
        active: check.active,
        details: check.details,
        now,
      });
      if (transition === "activated") {
        await this.client.sendMessage(
          this.adminUserId,
          `Castaryn: требуется внимание\n\n${check.problem}`,
          this.miniAppUrl,
        );
      } else if (transition === "recovered") {
        await this.client.sendMessage(
          this.adminUserId,
          `Castaryn: восстановлено\n\n${check.recovered}`,
          this.miniAppUrl,
        );
      }
    }
  }
}

function commandText(
  command: string,
  snapshot: Awaited<ReturnType<OperationsDashboardService["snapshot"]>>,
) {
  if (command === "/users") {
    return [
      "Castaryn: аккаунты",
      `Всего: ${snapshot.accounts.total}`,
      `Сегодня: +${snapshot.accounts.today}`,
      `За 7 дней: +${snapshot.accounts.last7Days}`,
    ].join("\n");
  }
  if (command === "/creators") {
    return [
      "Castaryn: Creator",
      `Активны: ${snapshot.creators.active}`,
      `Неактивны: ${snapshot.creators.inactive}`,
    ].join("\n");
  }
  if (command === "/integrations") {
    const integrations = snapshot.integrations.length
      ? snapshot.integrations.map(
          (item) =>
            `${item.provider}: ${item.ready}/${item.connected} готовы${item.failed ? `, ошибок ${item.failed}` : ""}`,
        )
      : ["Подключённых платформ нет"];
    return ["Castaryn: интеграции", ...integrations].join("\n");
  }
  if (command === "/site") {
    return [
      "Castaryn: сайт",
      snapshot.site.online
        ? `Онлайн, ответ ${snapshot.site.responseMs ?? "—"} мс`
        : "Недоступен",
      `Сегодня: ${snapshot.site.uniqueToday} посетителей / ${snapshot.site.viewsToday} просмотров`,
      `7 дней: ${snapshot.site.unique7Days} посетителей / ${snapshot.site.views7Days} просмотров`,
      `30 дней: ${snapshot.site.unique30Days} посетителей / ${snapshot.site.views30Days} просмотров`,
    ].join("\n");
  }
  const healthy =
    snapshot.site.online && snapshot.system.eventWorkerOnline;
  return [
    healthy
      ? "Castaryn: всё работает штатно"
      : "Castaryn: требуется внимание",
    `Сайт: ${snapshot.site.online ? "онлайн" : "недоступен"}`,
    `Creator worker: ${snapshot.system.eventWorkerOnline ? "онлайн" : "нет heartbeat"}`,
    `Диск: ${snapshot.system.diskUsedPercent}%`,
    `Память: ${snapshot.system.memoryUsedPercent}%`,
  ].join("\n");
}

async function probe(fetcher: typeof fetch, url: URL) {
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function certificateDaysRemaining(url: URL): Promise<number | null> {
  if (url.protocol !== "https:") return Promise.resolve(null);
  return new Promise((resolve) => {
    const socket = connect(
      {
        host: url.hostname,
        port: Number(url.port || 443),
        servername: url.hostname,
        rejectUnauthorized: true,
        timeout: 5_000,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        socket.end();
        const expiresAt = Date.parse(certificate.valid_to);
        resolve(
          Number.isFinite(expiresAt)
            ? Math.floor((expiresAt - Date.now()) / 86_400_000)
            : null,
        );
      },
    );
    socket.once("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.once("error", () => resolve(null));
  });
}
