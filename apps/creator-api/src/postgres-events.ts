import type { Sql, TransactionSql } from "postgres";
import { EventEffectSchema } from "./events.js";
import type {
  BalancePage,
  ConsumerKind,
  DispatchedEffect,
  ConfiguredEvent,
  EventDefinition,
  EventsProfile,
  EventsRepository,
  PurchaseResult,
  ViewerBalance,
  ViewerLookup,
} from "./events.js";
import { eventDefinitions } from "./events.js";
import type { CreatorRole } from "./authorization.js";
import { resolveCreatorRole } from "./postgres-roles.js";

type ProfileRow = {
  id: string;
  creator_identity_id: string;
  connection_id: string;
  name: string;
  currency_name: string;
  is_enabled: boolean;
  control_revision: string | number;
};

type BalanceRow = {
  viewer_key: string;
  display_name: string;
  balance: string | number;
};

type BalanceListRow = BalanceRow & { updated_at: Date };

type BalanceCursor = { updatedAt: Date; viewerKey: string };

function encodeBalanceCursor(cursor: BalanceCursor): string {
  return Buffer.from(
    JSON.stringify({ u: cursor.updatedAt.toISOString(), k: cursor.viewerKey }),
  ).toString("base64url");
}

// The cursor is an opaque token from the client's point of view, but it is
// still attacker-controlled input (forwarded straight from a query param),
// so a malformed or tampered value must degrade to "no cursor" instead of
// throwing and taking the endpoint down.
function decodeBalanceCursor(cursor: string): BalanceCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { u?: unknown }).u !== "string" ||
      typeof (parsed as { k?: unknown }).k !== "string"
    ) {
      return null;
    }
    const updatedAt = new Date((parsed as { u: string }).u);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, viewerKey: (parsed as { k: string }).k };
  } catch {
    return null;
  }
}

type EffectRow = {
  sequence: string;
  id: string;
  event_id: string;
  viewer_name: string;
  effect: DispatchedEffect["effect"];
  created_at: Date;
  is_test: boolean;
};

type EventConfigurationRow = {
  event_id: string;
  display_name: string;
  command: string;
  is_enabled: boolean;
  show_in_catalog: boolean;
};

export class PostgresEventsRepository implements EventsRepository {
  constructor(private readonly sql: Sql) {}

  resolveRole(
    actorUserId: string,
    creatorIdentityId: string,
  ): Promise<CreatorRole | null> {
    return resolveCreatorRole(this.sql, actorUserId, creatorIdentityId);
  }

  async rememberModeratorBadge(
    profileId: string,
    provider: string,
    externalUserId: string,
    displayName: string,
    verifiedAt: Date,
  ): Promise<void> {
    await this.sql`
      insert into event_moderator_badges (
        profile_id,
        provider,
        external_user_id,
        display_name,
        verified_at
      )
      values (
        ${profileId},
        ${provider},
        ${externalUserId},
        ${displayName},
        ${verifiedAt}
      )
      on conflict (profile_id, provider, external_user_id) do update
      set
        display_name = excluded.display_name,
        verified_at = excluded.verified_at
    `;
  }

  async getOrCreateProfileForCreator(
    creatorIdentityId: string,
  ): Promise<EventsProfile> {
    const rows = await this.sql<ProfileRow[]>`
      insert into event_profiles (
        creator_identity_id,
        connection_id,
        name,
        currency_name
      )
      select
        connections.creator_identity_id,
        connections.id,
        left(connections.channel_name || ' Events', 80),
        'Баллы'
      from streaming_connections connections
      -- Entitlement only requires an active subscription for this creator,
      -- not specifically one anchored (via streaming_connection_id) to
      -- this exact connection -- that anchor is set once at grant time and
      -- never updated, so requiring it to match would 404 this profile for
      -- any creator whose most-recently-active platform now differs from
      -- whichever one they had connected when the subscription was granted.
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id = connections.creator_identity_id
        and subscriptions.status = 'active'
        and (subscriptions.expires_at is null or subscriptions.expires_at > now())
      where connections.creator_identity_id = ${creatorIdentityId}
        and connections.disconnected_at is null
      order by connections.updated_at desc
      limit 1
      on conflict (connection_id) do update
      set
        connection_id = excluded.connection_id,
        updated_at = now()
      returning
        id,
        creator_identity_id,
        connection_id,
        name,
        currency_name,
        is_enabled,
        control_revision::text
    `;
    if (!rows[0]) throw new EventsProfileUnavailableError();
    await this.seedEventConfigurations(rows[0].id);
    return toProfile(rows[0]);
  }

  async getOrCreateProfileForChannel(
    provider: string,
    externalChannelId: string,
  ): Promise<EventsProfile | null> {
    const identities = await this.sql<Array<{ creator_identity_id: string }>>`
      select connections.creator_identity_id
      from streaming_connections connections
      -- Entitlement is per creator, not per platform: a subscription
      -- anchored to whichever connection existed at grant time must still
      -- unlock Castaryn Events on every platform the creator has since
      -- connected (e.g. granted via Twitch, later also connects YouTube).
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id = connections.creator_identity_id
        and subscriptions.status = 'active'
        and (subscriptions.expires_at is null or subscriptions.expires_at > now())
      where connections.provider = ${provider}
        and connections.external_channel_id = ${externalChannelId}
        and connections.disconnected_at is null
      limit 1
    `;
    return identities[0]
      ? this.getOrCreateProfileForCreator(identities[0].creator_identity_id)
      : null;
  }

  async updateProfile(
    creatorIdentityId: string,
    input: { name: string; currencyName: string; enabled: boolean },
  ): Promise<EventsProfile> {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<ProfileRow[]>`
        update event_profiles profiles
        set
          name = ${input.name},
          currency_name = ${input.currencyName},
          is_enabled = ${input.enabled},
          control_revision = case
            when profiles.is_enabled and not ${input.enabled}
              then profiles.control_revision + 1
            else profiles.control_revision
          end,
          updated_at = now()
        where profiles.connection_id = (
          select connections.id
          from streaming_connections connections
          where connections.creator_identity_id = ${creatorIdentityId}
            and connections.disconnected_at is null
          order by connections.updated_at desc
          limit 1
        )
        returning
          id,
          creator_identity_id,
          connection_id,
          name,
          currency_name,
          is_enabled,
          control_revision::text
      `;
      if (!rows[0]) throw new EventsProfileUnavailableError();
      if (!input.enabled) {
        await refundOutstanding(
          transaction,
          creatorIdentityId,
          new Date(),
          "cancelled",
        );
      }
      return toProfile(rows[0]);
    });
  }

  async stopEffects(creatorIdentityId: string, now: Date) {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ control_revision: string }>>`
        update event_profiles
        set
          control_revision = control_revision + 1,
          updated_at = ${now}
        where creator_identity_id = ${creatorIdentityId}
        returning control_revision::text
      `;
      if (!rows[0]) throw new EventsProfileUnavailableError();
      await refundOutstanding(
        transaction,
        creatorIdentityId,
        now,
        "cancelled",
      );
      return { controlRevision: rows[0].control_revision };
    });
  }

  async listEventConfigurations(
    profileId: string,
  ): Promise<ConfiguredEvent[]> {
    await this.seedEventConfigurations(profileId);
    const rows = await this.sql<EventConfigurationRow[]>`
      select
        event_id,
        display_name,
        command,
        is_enabled,
        show_in_catalog
      from event_configurations
      where profile_id = ${profileId}
    `;
    const byId = new Map(rows.map((row) => [row.event_id, row]));
    return eventDefinitions.map((definition) =>
      mergeConfiguration(definition, byId.get(definition.id)),
    );
  }

  async updateEventConfiguration(
    profileId: string,
    eventId: string,
    input: {
      name?: string;
      command?: string;
      enabled?: boolean;
      showInCatalog?: boolean;
    },
  ): Promise<ConfiguredEvent | null> {
    const definition = eventDefinitions.find((event) => event.id === eventId);
    if (!definition) return null;
    await this.seedEventConfigurations(profileId);
    const rows = await this.sql<EventConfigurationRow[]>`
      update event_configurations
      set
        display_name = coalesce(${input.name ?? null}, display_name),
        command = coalesce(${input.command ?? null}, command),
        is_enabled = coalesce(${input.enabled ?? null}, is_enabled),
        show_in_catalog = coalesce(
          ${input.showInCatalog ?? null},
          show_in_catalog
        ),
        updated_at = now()
      where profile_id = ${profileId}
        and event_id = ${eventId}
      returning
        event_id,
        display_name,
        command,
        is_enabled,
        show_in_catalog
    `;
    return rows[0] ? mergeConfiguration(definition, rows[0]) : null;
  }

  async getBalance(
    profileId: string,
    viewerKey: string,
    displayName: string,
    externalViewerId: string | null,
  ): Promise<ViewerBalance> {
    const rows = await this.sql<BalanceRow[]>`
      insert into event_viewer_balances (
        profile_id,
        viewer_key,
        external_viewer_id,
        display_name,
        balance
      )
      values (
        ${profileId},
        ${viewerKey},
        ${externalViewerId},
        ${displayName},
        0
      )
      on conflict (profile_id, viewer_key) do update
      set
        external_viewer_id = coalesce(
          excluded.external_viewer_id,
          event_viewer_balances.external_viewer_id
        ),
        display_name = excluded.display_name,
        updated_at = now()
      returning viewer_key, display_name, balance
    `;
    return toBalance(rows[0]!);
  }

  async adjustBalance(
    profileId: string,
    viewerKey: string,
    displayName: string | null,
    externalViewerId: string | null,
    amount: number,
  ): Promise<ViewerBalance | null> {
    const initialDisplayName = displayName ?? viewerKey;
    return this.sql.begin(async (transaction) => {
      await transaction`
        insert into event_viewer_balances (
          profile_id,
          viewer_key,
          external_viewer_id,
          display_name,
          balance
        )
        values (
          ${profileId},
          ${viewerKey},
          ${externalViewerId},
          ${initialDisplayName},
          0
        )
        on conflict (profile_id, viewer_key) do update
        set
          external_viewer_id = coalesce(
            excluded.external_viewer_id,
            event_viewer_balances.external_viewer_id
          ),
          display_name = coalesce(${displayName}, event_viewer_balances.display_name),
          updated_at = now()
      `;
      const rows = await transaction<BalanceRow[]>`
        update event_viewer_balances
        set balance = balance + ${amount}, updated_at = now()
        where profile_id = ${profileId}
          and viewer_key = ${viewerKey}
          and balance + ${amount} between 0 and 1000000000
        returning viewer_key, display_name, balance
      `;
      if (rows[0]) {
        await transaction`
          insert into event_balance_movements (
            profile_id,
            viewer_key,
            amount,
            reason
          )
          values (
            ${profileId},
            ${viewerKey},
            ${amount},
            'manual'
          )
        `;
      }
      return rows[0] ? toBalance(rows[0]) : null;
    });
  }

  async resolveViewer(profileId: string, typed: string): Promise<ViewerLookup> {
    const exact = await this.sql<
      Array<{ viewer_key: string; display_name: string }>
    >`
      select viewer_key, display_name
      from event_viewer_balances
      where profile_id = ${profileId} and viewer_key = ${typed}
      limit 1
    `;
    if (exact[0]) {
      return {
        status: "found",
        viewerKey: exact[0].viewer_key,
        displayName: exact[0].display_name,
      };
    }
    const byName = await this.sql<
      Array<{ viewer_key: string; display_name: string }>
    >`
      select viewer_key, display_name
      from event_viewer_balances
      where profile_id = ${profileId} and lower(display_name) = ${typed}
      limit 2
    `;
    if (byName.length > 1) return { status: "ambiguous" };
    const match = byName[0];
    return match
      ? { status: "found", viewerKey: match.viewer_key, displayName: match.display_name }
      : { status: "not_found" };
  }

  async listBalances(
    profileId: string,
    query: string | null,
    cursor: string | null,
    limit: number,
  ): Promise<BalancePage> {
    const decodedCursor = cursor ? decodeBalanceCursor(cursor) : null;
    const cursorUpdatedAt = decodedCursor?.updatedAt ?? null;
    const cursorViewerKey = decodedCursor?.viewerKey ?? null;
    const rows = await this.sql<BalanceListRow[]>`
      select viewer_key, display_name, balance, updated_at
      from event_viewer_balances
      where profile_id = ${profileId}
        and (
          ${query}::text is null
          or viewer_key like '%' || ${query} || '%'
          or lower(display_name) like '%' || ${query} || '%'
        )
        and (
          ${cursorUpdatedAt}::timestamptz is null
          or (updated_at, viewer_key) < (${cursorUpdatedAt}, ${cursorViewerKey})
        )
      order by updated_at desc, viewer_key desc
      limit ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = page.at(-1);
    return {
      items: page.map(toBalance),
      nextCursor:
        hasMore && lastRow
          ? encodeBalanceCursor({
              updatedAt: lastRow.updated_at,
              viewerKey: lastRow.viewer_key,
            })
          : null,
    };
  }

  async purchase(input: {
    profileId: string;
    viewerKey: string;
    displayName: string;
    externalViewerId: string | null;
    definition: EventDefinition;
    now: Date;
  }): Promise<PurchaseResult> {
    return this.sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${`${input.profileId}:${input.definition.id}`}, 0)
        )
      `;
      const operational = await transaction<
        Array<{ desktop_connected: boolean; events_enabled: boolean }>
      >`
        select
          profiles.is_enabled as events_enabled,
          exists (
            select 1
            from event_consumer_presence presence
            where presence.profile_id = profiles.id
              and presence.consumer_type = 'desktop'
              and presence.last_seen_at >= ${input.now} - interval '10 seconds'
          ) as desktop_connected
        from event_profiles profiles
        where profiles.id = ${input.profileId}
        for update
      `;
      if (!operational[0]?.events_enabled) return { status: "disabled" };
      if (!operational[0]?.desktop_connected) return { status: "offline" };
      await transaction`
        insert into event_viewer_balances (
          profile_id,
          viewer_key,
          external_viewer_id,
          display_name,
          balance
        )
        values (
          ${input.profileId},
          ${input.viewerKey},
          ${input.externalViewerId},
          ${input.displayName},
          0
        )
        on conflict (profile_id, viewer_key) do update
        set
          external_viewer_id = coalesce(
            excluded.external_viewer_id,
            event_viewer_balances.external_viewer_id
          ),
          display_name = excluded.display_name,
          updated_at = now()
      `;
      const cooldowns = await transaction<Array<{ available_at: Date }>>`
        select available_at
        from event_cooldowns
        where profile_id = ${input.profileId}
          and event_id = ${input.definition.id}
        for update
      `;
      const availableAt = cooldowns[0]?.available_at;
      if (availableAt && availableAt > input.now) {
        return {
          status: "cooldown",
          remainingSeconds: Math.max(
            1,
            Math.ceil((availableAt.getTime() - input.now.getTime()) / 1_000),
          ),
        };
      }
      const balances = await transaction<BalanceRow[]>`
        select viewer_key, display_name, balance
        from event_viewer_balances
        where profile_id = ${input.profileId}
          and viewer_key = ${input.viewerKey}
        for update
      `;
      const balance = Number(balances[0]!.balance);
      if (balance < input.definition.price) {
        return { status: "insufficient", balance };
      }
      const updated = await transaction<BalanceRow[]>`
        update event_viewer_balances
        set
          balance = balance - ${input.definition.price},
          updated_at = ${input.now}
        where profile_id = ${input.profileId}
          and viewer_key = ${input.viewerKey}
        returning viewer_key, display_name, balance
      `;
      await transaction`
        insert into event_cooldowns (profile_id, event_id, available_at)
        values (
          ${input.profileId},
          ${input.definition.id},
          ${new Date(
            input.now.getTime() + input.definition.cooldownSeconds * 1_000,
          )}
        )
        on conflict (profile_id, event_id) do update
        set available_at = excluded.available_at
      `;
      const effects = await transaction<EffectRow[]>`
        insert into event_effect_dispatches (
          profile_id,
          event_id,
          viewer_key,
          viewer_name,
          effect,
          price,
          is_test,
          delivery_status,
          delivery_deadline,
          created_at,
          expires_at
        )
        values (
          ${input.profileId},
          ${input.definition.id},
          ${input.viewerKey},
          ${input.displayName},
          ${transaction.json({
            ...input.definition.effect,
            parameters: {
              ...input.definition.effect.parameters,
              displayName: input.definition.name,
            },
          })},
          ${input.definition.price},
          false,
          'queued',
          ${new Date(input.now.getTime() + 15_000)},
          ${input.now},
          ${new Date(
            input.now.getTime() +
              (input.definition.durationSeconds + 120) * 1_000,
          )}
        )
        returning
          sequence::text,
          id,
          event_id,
          viewer_name,
          effect,
          is_test,
          created_at
      `;
      await transaction`
        insert into event_balance_movements (
          profile_id,
          viewer_key,
          amount,
          reason,
          dispatch_id,
          created_at
        )
        values (
          ${input.profileId},
          ${input.viewerKey},
          ${-input.definition.price},
          'event_purchase',
          ${effects[0]!.id},
          ${input.now}
        )
      `;
      return {
        status: "purchased",
        balance: Number(updated[0]!.balance),
        effect: toEffect(effects[0]!),
      };
    });
  }

  async listEffects(
    creatorIdentityId: string,
    afterSequence: string,
  ): Promise<DispatchedEffect[]> {
    const rows = await this.sql<EffectRow[]>`
      select
        dispatches.sequence::text,
        dispatches.id,
        dispatches.event_id,
        dispatches.viewer_name,
        dispatches.effect,
        dispatches.is_test,
        dispatches.created_at
      from event_effect_dispatches dispatches
      join event_profiles profiles on profiles.id = dispatches.profile_id
      where profiles.creator_identity_id = ${creatorIdentityId}
        and profiles.is_enabled
        and dispatches.sequence > ${afterSequence}::bigint
        and dispatches.expires_at > now()
        and dispatches.delivery_status = 'queued'
      order by dispatches.sequence
      limit 20
    `;
    return rows.map(toEffect);
  }

  async listPublicEffects(
    publicTokenHash: string,
    afterSequence: string,
  ): Promise<DispatchedEffect[] | null> {
    const configurations = await this.sql<
      Array<{ creator_identity_id: string }>
    >`
      select config.creator_identity_id
      from overlay_configurations config
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id = config.creator_identity_id
        and subscriptions.status = 'active'
        and (subscriptions.expires_at is null or subscriptions.expires_at > now())
        -- Any currently-connected platform satisfies entitlement, not
        -- specifically subscriptions.streaming_connection_id -- see the
        -- matching comment in postgres-repository.ts's findOverlayByTokenHash.
        and exists (
          select 1
          from streaming_connections connections
          where connections.creator_identity_id = config.creator_identity_id
            and connections.disconnected_at is null
        )
      where config.public_token_hash = ${publicTokenHash}
      limit 1
    `;
    if (!configurations[0]) return null;
    const rows = await this.sql<EffectRow[]>`
      select
        dispatches.sequence::text,
        dispatches.id,
        dispatches.event_id,
        dispatches.viewer_name,
        dispatches.effect,
        dispatches.is_test,
        dispatches.created_at
      from event_effect_dispatches dispatches
      join event_profiles profiles on profiles.id = dispatches.profile_id
      where profiles.creator_identity_id =
          ${configurations[0].creator_identity_id}
        and profiles.is_enabled
        and dispatches.sequence > ${afterSequence}::bigint
        and dispatches.expires_at > now()
        and dispatches.delivery_status = 'acknowledged'
      order by dispatches.sequence
      limit 20
    `;
    return rows.map(toEffect);
  }

  async latestSequence(creatorIdentityId: string): Promise<string> {
    const rows = await this.sql<Array<{ sequence: string }>>`
      select coalesce(max(dispatches.sequence)::text, '0') as sequence
      from event_effect_dispatches dispatches
      join event_profiles profiles on profiles.id = dispatches.profile_id
      where profiles.creator_identity_id = ${creatorIdentityId}
    `;
    return rows[0]?.sequence ?? "0";
  }

  async latestPublicSequence(
    publicTokenHash: string,
  ): Promise<string | null> {
    const creatorId = await this.resolvePublicCreator(publicTokenHash);
    if (!creatorId) return null;
    const rows = await this.sql<Array<{ sequence: string }>>`
      select coalesce(max(dispatches.sequence)::text, '0') as sequence
      from event_effect_dispatches dispatches
      join event_profiles profiles on profiles.id = dispatches.profile_id
      where profiles.creator_identity_id = ${creatorId}
        and dispatches.delivery_status = 'acknowledged'
    `;
    return rows[0]?.sequence ?? "0";
  }

  async heartbeat(
    creatorIdentityId: string,
    kind: "desktop",
    consumerId: string,
    now: Date,
  ) {
    return this.sql.begin(async (transaction) => {
      const presenceRows = await transaction<Array<{ profile_id: string }>>`
        insert into event_consumer_presence (
          profile_id,
          consumer_type,
          consumer_id,
          last_seen_at
        )
        select id, ${kind}, ${consumerId}, ${now}
        from event_profiles
        where creator_identity_id = ${creatorIdentityId}
        on conflict (profile_id, consumer_type) do update
        set
          consumer_id = excluded.consumer_id,
          last_seen_at = excluded.last_seen_at
        returning profile_id
      `;
      if (!presenceRows[0]) throw new EventsProfileUnavailableError();
      const profiles = await transaction<Array<{ control_revision: string }>>`
        select control_revision::text
        from event_profiles
        where id = ${presenceRows[0].profile_id}
      `;
      if (!profiles[0]) throw new EventsProfileUnavailableError();
      return { controlRevision: profiles[0].control_revision };
    });
  }

  async heartbeatPublic(
    publicTokenHash: string,
    consumerId: string,
    now: Date,
  ) {
    const creatorId = await this.resolvePublicCreator(publicTokenHash);
    if (!creatorId) return null;
    return this.sql.begin(async (transaction) => {
      const presenceRows = await transaction<Array<{ profile_id: string }>>`
        insert into event_consumer_presence (
          profile_id,
          consumer_type,
          consumer_id,
          last_seen_at
        )
        select id, 'overlay', ${consumerId}, ${now}
        from event_profiles
        where creator_identity_id = ${creatorId}
        on conflict (profile_id, consumer_type) do update
        set
          consumer_id = excluded.consumer_id,
          last_seen_at = excluded.last_seen_at
        returning profile_id
      `;
      if (!presenceRows[0]) return null;
      const profiles = await transaction<Array<{ control_revision: string }>>`
        select control_revision::text
        from event_profiles
        where id = ${presenceRows[0].profile_id}
      `;
      return profiles[0]
        ? { controlRevision: profiles[0].control_revision }
        : null;
    });
  }

  async acknowledge(
    creatorIdentityId: string,
    effectId: string,
    kind: "desktop",
    now: Date,
  ) {
    return this.acknowledgeForCreator(
      creatorIdentityId,
      effectId,
      kind,
      now,
    );
  }

  async acknowledgePublic(
    publicTokenHash: string,
    effectId: string,
    now: Date,
  ) {
    const creatorId = await this.resolvePublicCreator(publicTokenHash);
    if (!creatorId) return false;
    return this.acknowledgeForCreator(
      creatorId,
      effectId,
      "overlay",
      now,
    );
  }

  async refundTimedOut(now: Date) {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ creator_identity_id: string }>>`
        select profiles.creator_identity_id
        from event_effect_dispatches dispatches
        join event_profiles profiles on profiles.id = dispatches.profile_id
        where dispatches.delivery_status = 'queued'
          and dispatches.is_test = false
          and dispatches.delivery_deadline <= ${now}
        limit 100
      `;
      let refunded = 0;
      for (const creatorIdentityId of new Set(
        rows.map((row) => row.creator_identity_id),
      )) {
        refunded += await refundOutstanding(
          transaction,
          creatorIdentityId,
          now,
          "timeout",
          true,
        );
      }
      return refunded;
    });
  }

  private async resolvePublicCreator(publicTokenHash: string) {
    const rows = await this.sql<Array<{ creator_identity_id: string }>>`
      select config.creator_identity_id
      from overlay_configurations config
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id = config.creator_identity_id
        and subscriptions.status = 'active'
        and (subscriptions.expires_at is null or subscriptions.expires_at > now())
        -- Any currently-connected platform satisfies entitlement, not
        -- specifically subscriptions.streaming_connection_id -- see the
        -- matching comment in postgres-repository.ts's findOverlayByTokenHash.
        and exists (
          select 1
          from streaming_connections connections
          where connections.creator_identity_id = config.creator_identity_id
            and connections.disconnected_at is null
        )
      where config.public_token_hash = ${publicTokenHash}
      limit 1
    `;
    return rows[0]?.creator_identity_id ?? null;
  }

  private async seedEventConfigurations(profileId: string) {
    const ids = eventDefinitions.map((event) => event.id);
    const names = eventDefinitions.map((event) => event.name);
    const commands = eventDefinitions.map((event) => event.command);
    await this.sql`
      insert into event_configurations (
        profile_id,
        event_id,
        display_name,
        command
      )
      select
        ${profileId},
        defaults.event_id,
        defaults.display_name,
        defaults.command
      from unnest(
        ${ids}::text[],
        ${names}::text[],
        ${commands}::text[]
      ) as defaults(event_id, display_name, command)
      on conflict (profile_id, event_id) do nothing
    `;
  }

  private async acknowledgeForCreator(
    creatorIdentityId: string,
    effectId: string,
    kind: ConsumerKind,
    now: Date,
  ) {
    const rows =
      kind === "desktop"
        ? await this.sql<Array<{ id: string }>>`
            update event_effect_dispatches dispatches
            set
              desktop_acknowledged_at = coalesce(
                dispatches.desktop_acknowledged_at,
                ${now}
              ),
              delivery_status = 'acknowledged'
            from event_profiles profiles
            where dispatches.profile_id = profiles.id
              and profiles.creator_identity_id = ${creatorIdentityId}
              and dispatches.id = ${effectId}
              and dispatches.delivery_status = 'queued'
              and dispatches.delivery_deadline > ${now}
            returning dispatches.id
          `
        : await this.sql<Array<{ id: string }>>`
            update event_effect_dispatches dispatches
            set overlay_acknowledged_at = coalesce(
              dispatches.overlay_acknowledged_at,
              ${now}
            )
            from event_profiles profiles
            where dispatches.profile_id = profiles.id
              and profiles.creator_identity_id = ${creatorIdentityId}
              and dispatches.id = ${effectId}
              and dispatches.delivery_status in ('queued', 'acknowledged')
            returning dispatches.id
          `;
    return rows.length > 0;
  }
}

async function refundOutstanding(
  transaction: TransactionSql,
  creatorIdentityId: string,
  now: Date,
  reason: "cancelled" | "timeout",
  timedOutOnly = false,
) {
  const rows = await transaction<
    Array<{
      id: string;
      profile_id: string;
      event_id: string;
      viewer_key: string;
      price: string | number;
      is_test: boolean;
    }>
  >`
    select
      dispatches.id,
      dispatches.profile_id,
      dispatches.event_id,
      dispatches.viewer_key,
      dispatches.price,
      dispatches.is_test
    from event_effect_dispatches dispatches
    join event_profiles profiles on profiles.id = dispatches.profile_id
    where profiles.creator_identity_id = ${creatorIdentityId}
      and dispatches.delivery_status = 'queued'
      and (
        ${timedOutOnly} = false
        or dispatches.delivery_deadline <= ${now}
      )
    for update of dispatches skip locked
  `;
  let refunded = 0;
  for (const row of rows) {
    if (!row.is_test && Number(row.price) > 0) {
      await transaction`
        update event_viewer_balances
        set
          balance = balance + ${Number(row.price)},
          updated_at = ${now}
        where profile_id = ${row.profile_id}
          and viewer_key = ${row.viewer_key}
      `;
      await transaction`
        insert into event_balance_movements (
          profile_id,
          viewer_key,
          amount,
          reason,
          dispatch_id,
          created_at
        )
        values (
          ${row.profile_id},
          ${row.viewer_key},
          ${Number(row.price)},
          'event_refund',
          ${row.id},
          ${now}
        )
        on conflict do nothing
      `;
      refunded += 1;
    }
    await transaction`
      update event_effect_dispatches
      set
        delivery_status = ${row.is_test ? "cancelled" : "refunded"},
        refunded_at = ${row.is_test ? null : now},
        cancelled_at = ${reason === "cancelled" ? now : null}
      where id = ${row.id}
        and delivery_status = 'queued'
    `;
    await transaction`
      delete from event_cooldowns
      where profile_id = ${row.profile_id}
        and event_id = ${row.event_id}
    `;
  }
  return refunded;
}

function toProfile(row: ProfileRow): EventsProfile {
  return {
    id: row.id,
    creatorIdentityId: row.creator_identity_id,
    connectionId: row.connection_id,
    name: row.name,
    currencyName: row.currency_name,
    isEnabled: row.is_enabled,
    controlRevision: String(row.control_revision),
  };
}

function toBalance(row: BalanceRow): ViewerBalance {
  return {
    viewerKey: row.viewer_key,
    displayName: row.display_name,
    balance: Number(row.balance),
  };
}

function toEffect(row: EffectRow): DispatchedEffect {
  return {
    sequence: row.sequence,
    id: row.id,
    eventId: row.event_id,
    viewerName: row.viewer_name,
    effect: EventEffectSchema.parse(row.effect),
    createdAt: row.created_at.toISOString(),
  };
}

function mergeConfiguration(
  definition: EventDefinition,
  row: EventConfigurationRow | undefined,
): ConfiguredEvent {
  return {
    ...definition,
    name: row?.display_name ?? definition.name,
    command: row?.command ?? definition.command,
    enabled: row?.is_enabled ?? true,
    showInCatalog: row?.show_in_catalog ?? true,
  };
}

export class EventsProfileUnavailableError extends Error {}
