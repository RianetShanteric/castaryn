import { createHmac } from "node:crypto";

export type SiteVisit = {
  visitedOn: string;
  visitorHash: string;
  path: string;
  referrerHost: string | null;
  createdAt: Date;
};

export interface SiteAnalyticsRepository {
  recordVisit(visit: SiteVisit): Promise<void>;
}

export class SiteAnalyticsService {
  constructor(
    private readonly repository: SiteAnalyticsRepository,
    private readonly secret: string,
  ) {}

  async record(input: {
    ip: string;
    userAgent: string;
    path: string;
    referrer?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const visitedOn = now.toISOString().slice(0, 10);
    const path = sanitizePath(input.path);
    const referrerHost = sanitizeReferrer(input.referrer);
    const visitorHash = createHmac("sha256", this.secret)
      .update(`${visitedOn}\n${input.ip}\n${input.userAgent}`)
      .digest("hex");

    await this.repository.recordVisit({
      visitedOn,
      visitorHash,
      path,
      referrerHost,
      createdAt: now,
    });
  }
}

function sanitizePath(value: string) {
  const path = value.trim();
  if (!path.startsWith("/") || path.length > 160) return "/";
  return path.split(/[?#]/, 1)[0] || "/";
}

function sanitizeReferrer(value?: string) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.slice(0, 253) || null;
  } catch {
    return null;
  }
}
