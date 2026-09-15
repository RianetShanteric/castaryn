import type { Sql } from "postgres";
import type { OperationsRepository } from "./operations-dashboard.js";
import type {
  SiteAnalyticsRepository,
  SiteVisit,
} from "./site-analytics.js";
import type { TelegramAlertRepository } from "./telegram-bot.js";

export class PostgresSiteAnalyticsRepository
  implements SiteAnalyticsRepository
{
  constructor(private readonly sql: Sql) {}

  async recordVisit(visit: SiteVisit) {
    await this.sql`
      insert into site_page_views (
        visited_on,
        visitor_hash,
        path,
        referrer_host,
        created_at
      )
      values (
        ${visit.visitedOn},
        ${visit.visitorHash},
        ${visit.path},
        ${visit.referrerHost},
        ${visit.createdAt}
      )
    `;
  }
}

export class PostgresOperationsRepository implements OperationsRepository {
  constructor(private readonly sql: Sql) {}

  async readOperationsData() {
    const [
      accountRows,
      subscriptionRows,
      integrationRows,
      botRows,
      siteRows,
      heartbeatRows,
    ] = await Promise.all([
      this.sql<Array<{ total: number; today: number; week: number }>>`
        select
          count(*)::int as total,
          count(*) filter (where created_at >= current_date)::int as today,
          count(*) filter (where created_at >= current_date - interval '6 days')::int as week
        from castaryn_accounts
      `,
      this.sql<Array<{ plan: string; status: string; count: number }>>`
        select plan_type as plan, status, count(*)::int as count
        from creator_subscriptions
        group by plan_type, status
      `,
      this.sql<
        Array<{
          provider: string;
          connected: number;
          ready: number;
          failed: number;
        }>
      >`
        select
          provider,
          count(*) filter (where disconnected_at is null)::int as connected,
          count(*) filter (
            where disconnected_at is null and eventsub_status = 'ready'
          )::int as ready,
          count(*) filter (
            where disconnected_at is null and eventsub_status = 'failed'
          )::int as failed
        from streaming_connections
        group by provider
      `,
      this.sql<Array<{ provider: string }>>`
        select provider
        from streaming_bot_credentials
        where invalidated_at is null
      `,
      this.sql<
        Array<{
          views_today: number;
          unique_today: number;
          views_week: number;
          unique_week: number;
          views_month: number;
          unique_month: number;
        }>
      >`
        select
          count(*) filter (where created_at >= current_date)::int as views_today,
          count(distinct visitor_hash) filter (
            where created_at >= current_date
          )::int as unique_today,
          count(*) filter (
            where created_at >= current_date - interval '6 days'
          )::int as views_week,
          count(distinct (visited_on, visitor_hash)) filter (
            where created_at >= current_date - interval '6 days'
          )::int as unique_week,
          count(*) filter (
            where created_at >= current_date - interval '29 days'
          )::int as views_month,
          count(distinct (visited_on, visitor_hash)) filter (
            where created_at >= current_date - interval '29 days'
          )::int as unique_month
        from site_page_views
      `,
      this.sql<Array<{ last_seen_at: Date }>>`
        select last_seen_at
        from creator_service_heartbeats
        where service_name = 'event_worker'
      `,
    ]);

    const subscriptions = subscriptionRows;
    const byPlan: Record<string, number> = {};
    let active = 0;
    let inactive = 0;
    for (const row of subscriptions) {
      byPlan[row.plan] = (byPlan[row.plan] ?? 0) + row.count;
      if (row.status === "active") active += row.count;
      else inactive += row.count;
    }
    const bots = new Set(botRows.map((row) => row.provider));
    const providers = new Set([
      ...integrationRows.map((row) => row.provider),
      ...bots,
    ]);
    const integrationByProvider = new Map(
      integrationRows.map((row) => [row.provider, row]),
    );
    const accounts = accountRows[0] ?? { total: 0, today: 0, week: 0 };
    const site = siteRows[0] ?? {
      views_today: 0,
      unique_today: 0,
      views_week: 0,
      unique_week: 0,
      views_month: 0,
      unique_month: 0,
    };

    return {
      accounts: {
        total: accounts.total,
        today: accounts.today,
        last7Days: accounts.week,
      },
      creators: { active, inactive, byPlan },
      integrations: [...providers]
        .sort()
        .map((provider) => ({
          provider,
          connected: integrationByProvider.get(provider)?.connected ?? 0,
          ready: integrationByProvider.get(provider)?.ready ?? 0,
          failed: integrationByProvider.get(provider)?.failed ?? 0,
          botAuthorized: bots.has(provider),
        })),
      site: {
        viewsToday: site.views_today,
        uniqueToday: site.unique_today,
        views7Days: site.views_week,
        unique7Days: site.unique_week,
        views30Days: site.views_month,
        unique30Days: site.unique_month,
      },
      eventWorkerLastSeenAt: heartbeatRows[0]?.last_seen_at ?? null,
    };
  }
}

export class PostgresTelegramAlertRepository
  implements TelegramAlertRepository
{
  constructor(private readonly sql: Sql) {}

  async changeAlertState(input: {
    key: string;
    active: boolean;
    details: Record<string, string | number | boolean | null>;
    now: Date;
  }) {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ is_active: boolean }>>`
        select is_active
        from telegram_alert_states
        where alert_key = ${input.key}
        for update
      `;
      const previous = rows[0]?.is_active;
      const transition =
        previous === undefined
          ? input.active
            ? "activated"
            : "unchanged"
          : previous === input.active
            ? "unchanged"
            : input.active
              ? "activated"
              : "recovered";
      await transaction`
        insert into telegram_alert_states (
          alert_key,
          is_active,
          changed_at,
          last_notified_at,
          details
        )
        values (
          ${input.key},
          ${input.active},
          ${input.now},
          ${transition === "unchanged" ? null : input.now},
          ${transaction.json(input.details)}
        )
        on conflict (alert_key) do update
        set
          is_active = excluded.is_active,
          changed_at = case
            when telegram_alert_states.is_active <> excluded.is_active
              then excluded.changed_at
            else telegram_alert_states.changed_at
          end,
          last_notified_at = coalesce(
            excluded.last_notified_at,
            telegram_alert_states.last_notified_at
          ),
          details = excluded.details
      `;
      return transition;
    });
  }
}
