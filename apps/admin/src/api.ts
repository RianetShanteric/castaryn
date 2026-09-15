import { z } from "zod";

const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  plan: z.enum(["trial", "monthly", "yearly", "lifetime"]),
  status: z.enum(["active", "expired", "cancelled"]),
  source: z.enum(["payment", "developer_grant", "gift"]),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
});

export const AdminCreatorRecordSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  creatorIdentityId: z.string().uuid(),
  streamingProvider: z.string().nullable(),
  streamingChannelId: z.string().nullable(),
  streamingChannelName: z.string().nullable(),
  subscription: SubscriptionSchema.nullable(),
});
export type AdminCreatorRecord = z.infer<typeof AdminCreatorRecordSchema>;

const BotStatusSchema = z.object({
  connected: z.boolean(),
  externalUserId: z.string().nullable(),
  scopes: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
});
export type TwitchBotStatus = z.infer<typeof BotStatusSchema>;
const YoutubeBotStatusSchema = BotStatusSchema.extend({
  configured: z.boolean(),
});
export type YoutubeBotStatus = z.infer<typeof YoutubeBotStatusSchema>;

export class AdminApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string>,
  ) {}

  search(query: string) {
    return this.request(
      `/internal/admin/users?query=${encodeURIComponent(query)}`,
      {},
      z.array(AdminCreatorRecordSchema),
    );
  }

  getTwitchBotStatus() {
    return this.request(
      "/internal/admin/integrations/twitch-bot",
      {},
      BotStatusSchema,
    );
  }

  authorizeTwitchBot() {
    return this.request(
      "/internal/admin/integrations/twitch-bot/authorize",
      { method: "POST", body: "{}" },
      z.object({ authorizeUrl: z.string().url() }),
    );
  }

  getYoutubeBotStatus() {
    return this.request(
      "/internal/admin/integrations/youtube-bot",
      {},
      YoutubeBotStatusSchema,
    );
  }

  authorizeYoutubeBot() {
    return this.request(
      "/internal/admin/integrations/youtube-bot/authorize",
      { method: "POST", body: "{}" },
      z.object({ authorizeUrl: z.string().url() }),
    );
  }

  getUser(userId: string) {
    return this.request(
      `/internal/admin/users/${encodeURIComponent(userId)}`,
      {},
      AdminCreatorRecordSchema,
    );
  }

  grantLifetime(
    userId: string,
    source: "developer_grant" | "gift",
    reason: string,
  ) {
    return this.request(
      `/internal/admin/users/${encodeURIComponent(userId)}/grant-lifetime`,
      {
        method: "POST",
        body: JSON.stringify({ source, reason }),
      },
      AdminCreatorRecordSchema,
    );
  }

  async changePlan(
    subscriptionId: string,
    plan: "trial" | "monthly" | "yearly" | "lifetime",
    reason: string,
  ) {
    await this.requestWithoutBody(
      `/internal/admin/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ plan, reason }),
      },
    );
  }

  async cancel(subscriptionId: string, reason: string) {
    await this.requestWithoutBody(
      `/internal/admin/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.fetch(path, init);
    return schema.parse(await response.json());
  }

  private async requestWithoutBody(path: string, init: RequestInit) {
    await this.fetch(path, init);
  }

  private async fetch(path: string, init: RequestInit) {
    const token = await this.getToken();
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Admin request failed (${response.status})`);
    }
    return response;
  }
}
