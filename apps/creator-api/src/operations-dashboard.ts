import { statfs } from "node:fs/promises";
import { freemem, totalmem } from "node:os";

export type OperationsSnapshot = {
  generatedAt: Date;
  accounts: {
    total: number;
    today: number;
    last7Days: number;
  };
  creators: {
    active: number;
    inactive: number;
    byPlan: Record<string, number>;
  };
  integrations: Array<{
    provider: string;
    connected: number;
    ready: number;
    failed: number;
    botAuthorized: boolean;
  }>;
  site: {
    viewsToday: number;
    uniqueToday: number;
    views7Days: number;
    unique7Days: number;
    views30Days: number;
    unique30Days: number;
    responseMs: number | null;
    online: boolean;
  };
  system: {
    apiUptimeSeconds: number;
    memoryUsedPercent: number;
    diskUsedPercent: number;
    eventWorkerOnline: boolean;
  };
};

export interface OperationsRepository {
  readOperationsData(): Promise<
    Omit<OperationsSnapshot, "generatedAt" | "site" | "system"> & {
      site: Omit<OperationsSnapshot["site"], "responseMs" | "online">;
      eventWorkerLastSeenAt: Date | null;
    }
  >;
}

export class OperationsDashboardService {
  constructor(
    private readonly repository: OperationsRepository,
    private readonly siteUrl: URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async snapshot(now = new Date()): Promise<OperationsSnapshot> {
    const [data, siteProbe, disk] = await Promise.all([
      this.repository.readOperationsData(),
      probe(this.fetcher, this.siteUrl),
      statfs("/"),
    ]);
    const memoryTotal = totalmem();
    const diskTotal = disk.blocks * disk.bsize;
    const diskFree = disk.bavail * disk.bsize;

    return {
      generatedAt: now,
      accounts: data.accounts,
      creators: data.creators,
      integrations: data.integrations,
      site: {
        ...data.site,
        online: siteProbe.online,
        responseMs: siteProbe.responseMs,
      },
      system: {
        apiUptimeSeconds: Math.round(process.uptime()),
        memoryUsedPercent: percent(memoryTotal - freemem(), memoryTotal),
        diskUsedPercent: percent(diskTotal - diskFree, diskTotal),
        eventWorkerOnline:
          data.eventWorkerLastSeenAt !== null &&
          now.getTime() - data.eventWorkerLastSeenAt.getTime() < 120_000,
      },
    };
  }
}

async function probe(fetcher: typeof fetch, url: URL) {
  const startedAt = performance.now();
  try {
    const response = await fetcher(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });
    return {
      online: response.ok,
      responseMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return { online: false, responseMs: null };
  }
}

function percent(used: number, total: number) {
  return total <= 0 ? 0 : Math.round((used / total) * 1_000) / 10;
}
