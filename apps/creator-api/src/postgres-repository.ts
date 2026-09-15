import type { Sql } from "postgres";
import type {
  CreatorSubscription,
  SubscriptionPlan,
  SubscriptionSource,
  SubscriptionStatus,
} from "./domain.js";
import type { SubscriptionRepository } from "./access-service.js";
import type {
  ConnectedChannel,
  ConnectedYoutubeChannel,
  CreatorPlatformRepository,
  OAuthState,
  StoredTwitchCredential,
  StoredYoutubeCredential,
} from "./creator-platform.js";
import type {
  CreatorFeaturesRepository,
  OverlayConfiguration,
  OverlayField,
  PublicOverlaySnapshot,
  PublicStreamState,
  StreamingCommand,
} from "./creator-features.js";
import type { CreatorRole } from "./authorization.js";
import type {
  AdminCreatorRecord,
  AdminRepository,
} from "./admin-service.js";
import { AdminStreamingConnectionRequiredError } from "./admin-service.js";
import { resolveCreatorRole } from "./postgres-roles.js";

type SubscriptionRow = {
  id: string;
  user_id: string;
  creator_identity_id: string;
  streaming_connection_id: string | null;
  plan_type: SubscriptionPlan;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  created_at: Date;
  expires_at: Date | null;
};

export class PostgresSubscriptionRepository
  implements SubscriptionRepository
{
  constructor(private readonly sql: Sql) {}

  async findCurrentForUser(
    userId: string,
  ): Promise<CreatorSubscription | null> {
    const rows = await this.sql<SubscriptionRow[]>`
      select
        creator_subscriptions.id,
        creator_subscriptions.user_id,
        creator_subscriptions.creator_identity_id,
        creator_subscriptions.streaming_connection_id,
        creator_subscriptions.plan_type,
        creator_subscriptions.status,
        creator_subscriptions.source,
        creator_subscriptions.created_at,
        creator_subscriptions.expires_at
      from creator_subscriptions
      -- Entitlement is per creator, not per platform connection: the
      -- subscription's streaming_connection_id only records whichever
      -- connection was active at grant time and is never updated again, so
      -- requiring that exact connection to still be attached would revoke
      -- access the moment a paying creator disconnects (or switches) that
      -- one platform while still having another connected.
      where creator_subscriptions.user_id = ${userId}
        and exists (
          select 1
          from streaming_connections connections
          where connections.creator_identity_id =
            creator_subscriptions.creator_identity_id
            and connections.disconnected_at is null
        )
      order by creator_subscriptions.created_at desc
      limit 1
    `;
    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.user_id,
      creatorIdentityId: row.creator_identity_id,
      streamingConnectionId: row.streaming_connection_id,
      plan: row.plan_type,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async markExpired(subscriptionId: string, expiredAt: Date): Promise<void> {
    await this.sql`
      update creator_subscriptions
      set status = 'expired', updated_at = ${expiredAt}
      where id = ${subscriptionId} and status = 'active'
    `;
  }
}

type OAuthStateRow = {
  user_id: string;
  provider: string;
  expires_at: Date;
};

type ConnectionRow = {
  id: string;
  external_channel_id: string;
  external_login: string | null;
  channel_name: string;
  connected_at: Date;
};

export class PostgresCreatorPlatformRepository
  implements CreatorPlatformRepository
{
  constructor(private readonly sql: Sql) {}

  async ensureAccount(input: {
    issuer: string;
    subject: string;
    email: string;
    emailVerified: boolean;
  }): Promise<string> {
    return this.sql.begin(async (transaction) => {
      const accounts = await transaction<Array<{ id: string }>>`
        insert into castaryn_accounts (
          id,
          email,
          external_issuer,
          external_subject,
          email_verified,
          updated_at
        )
        values (
          gen_random_uuid(),
          ${input.email.toLowerCase()},
          ${input.issuer},
          ${input.subject},
          ${input.emailVerified},
          now()
        )
        on conflict (external_issuer, external_subject) do update
        set
          email = excluded.email,
          email_verified = excluded.email_verified,
          updated_at = now()
        returning id
      `;
      const userId = accounts[0]!.id;
      await transaction`
        insert into creator_identities (id, user_id)
        values (gen_random_uuid(), ${userId})
        on conflict (user_id) do nothing
      `;
      return userId;
    });
  }

  async storeOAuthState(input: {
    stateHash: string;
    userId: string;
    provider: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.sql`
      insert into oauth_connection_states (
        state_hash,
        user_id,
        provider,
        expires_at
      )
      values (
        ${input.stateHash},
        ${input.userId},
        ${input.provider},
        ${input.expiresAt}
      )
    `;
  }

  async consumeOAuthState(
    stateHash: string,
    now: Date,
  ): Promise<OAuthState | null> {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<OAuthStateRow[]>`
        update oauth_connection_states
        set consumed_at = ${now}
        where state_hash = ${stateHash}
          and consumed_at is null
          and expires_at > ${now}
        returning user_id, provider, expires_at
      `;
      const row = rows[0];
      return row
        ? {
            userId: row.user_id,
            provider: row.provider,
            expiresAt: row.expires_at,
          }
        : null;
    });
  }

  async upsertTwitchConnection(input: {
    userId: string;
    channel: {
      id: string;
      login: string;
      displayName: string;
    };
    token: {
      expiresAt: Date;
      scopes: string[];
    };
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
  }): Promise<ConnectedChannel> {
    const rows = await this.sql<ConnectionRow[]>`
      insert into streaming_connections (
        id,
        creator_identity_id,
        provider,
        external_channel_id,
        external_login,
        channel_name,
        scopes,
        access_token_ciphertext,
        refresh_token_ciphertext,
        token_expires_at,
        disconnected_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        (
          select id
          from creator_identities
          where user_id = ${input.userId}
        ),
        'twitch',
        ${input.channel.id},
        ${input.channel.login},
        ${input.channel.displayName},
        ${input.token.scopes},
        ${input.encryptedAccessToken},
        ${input.encryptedRefreshToken},
        ${input.token.expiresAt},
        null,
        now()
      )
      on conflict (provider, external_channel_id) do update
      set
        external_login = excluded.external_login,
        channel_name = excluded.channel_name,
        scopes = excluded.scopes,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        token_expires_at = excluded.token_expires_at,
        disconnected_at = null,
        updated_at = now()
      where
        streaming_connections.creator_identity_id =
        excluded.creator_identity_id
      returning
        id,
        external_channel_id,
        external_login,
        channel_name,
        connected_at
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("Twitch channel is already connected to another account");
    }
    return toConnectedChannel(row);
  }

  async findTwitchConnection(
    userId: string,
  ): Promise<ConnectedChannel | null> {
    const rows = await this.sql<ConnectionRow[]>`
      select
        streaming_connections.id,
        streaming_connections.external_channel_id,
        streaming_connections.external_login,
        streaming_connections.channel_name,
        streaming_connections.connected_at
      from streaming_connections
      join creator_identities identities
        on identities.id = streaming_connections.creator_identity_id
      where identities.user_id = ${userId}
        and streaming_connections.provider = 'twitch'
        and streaming_connections.disconnected_at is null
      order by streaming_connections.updated_at desc
      limit 1
    `;
    return rows[0] ? toConnectedChannel(rows[0]) : null;
  }

  async disconnectTwitch(userId: string, now: Date): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const identities = await transaction<Array<{ id: string }>>`
        select id from creator_identities where user_id = ${userId}
      `;
      const creatorIdentityId = identities[0]?.id;
      if (!creatorIdentityId) return;
      await transaction`
        update streaming_connections
        set
          disconnected_at = ${now},
          access_token_ciphertext = null,
          refresh_token_ciphertext = null,
          token_expires_at = null,
          updated_at = ${now}
        where creator_identity_id = ${creatorIdentityId}
          and provider = 'twitch'
          and disconnected_at is null
      `;
      await transaction`
        update overlay_configurations
        set
          public_token_hash = 'revoked:' || gen_random_uuid()::text,
          updated_at = ${now}
        where creator_identity_id = ${creatorIdentityId}
      `;
    });
  }

  async listTwitchCredentials(): Promise<StoredTwitchCredential[]> {
    const rows = await this.sql<
      Array<{
        id: string;
        external_channel_id: string;
        access_token_ciphertext: string;
        refresh_token_ciphertext: string;
        token_expires_at: Date;
      }>
    >`
      select
        id,
        external_channel_id,
        access_token_ciphertext,
        refresh_token_ciphertext,
        token_expires_at
      from streaming_connections
      where provider = 'twitch'
        and disconnected_at is null
        and access_token_ciphertext is not null
        and refresh_token_ciphertext is not null
        and token_expires_at is not null
    `;
    return rows.map((row) => ({
      connectionId: row.id,
      externalChannelId: row.external_channel_id,
      encryptedAccessToken: row.access_token_ciphertext,
      encryptedRefreshToken: row.refresh_token_ciphertext,
      expiresAt: row.token_expires_at,
    }));
  }

  async updateTwitchCredential(
    connectionId: string,
    input: {
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      expiresAt: Date;
      scopes: string[];
    },
  ) {
    await this.sql`
      update streaming_connections
      set
        access_token_ciphertext = ${input.encryptedAccessToken},
        refresh_token_ciphertext = ${input.encryptedRefreshToken},
        token_expires_at = ${input.expiresAt},
        scopes = ${input.scopes},
        updated_at = now()
      where id = ${connectionId}
        and provider = 'twitch'
        and disconnected_at is null
    `;
  }

  async invalidateTwitchConnection(connectionId: string, now: Date) {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ creator_identity_id: string }>>`
        update streaming_connections
        set
          disconnected_at = ${now},
          access_token_ciphertext = null,
          refresh_token_ciphertext = null,
          token_expires_at = null,
          updated_at = ${now}
        where id = ${connectionId}
        returning creator_identity_id
      `;
      if (rows[0]) {
        await transaction`
          update overlay_configurations
          set
            public_token_hash = 'revoked:' || gen_random_uuid()::text,
            updated_at = ${now}
          where creator_identity_id = ${rows[0].creator_identity_id}
        `;
      }
    });
  }

  async updateTwitchEventSubStatus(
    connectionId: string,
    status: "pending" | "ready" | "failed",
    checkedAt: Date,
  ) {
    await this.sql`
      update streaming_connections
      set
        eventsub_status = ${status},
        eventsub_checked_at = ${checkedAt},
        updated_at = ${checkedAt}
      where id = ${connectionId}
        and provider = 'twitch'
        and disconnected_at is null
    `;
  }

  async confirmTwitchEventSub(
    externalChannelId: string,
    confirmedAt: Date,
  ) {
    await this.sql`
      update streaming_connections
      set
        eventsub_status = 'ready',
        eventsub_checked_at = ${confirmedAt},
        updated_at = ${confirmedAt}
      where provider = 'twitch'
        and external_channel_id = ${externalChannelId}
        and disconnected_at is null
    `;
  }

  async upsertYoutubeConnection(input: {
    userId: string;
    channel: {
      id: string;
      login: string;
      displayName: string;
    };
    token: {
      expiresAt: Date;
      scopes: string[];
    };
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
  }): Promise<ConnectedYoutubeChannel> {
    const rows = await this.sql<ConnectionRow[]>`
      insert into streaming_connections (
        id,
        creator_identity_id,
        provider,
        external_channel_id,
        external_login,
        channel_name,
        scopes,
        access_token_ciphertext,
        refresh_token_ciphertext,
        token_expires_at,
        disconnected_at,
        updated_at
      )
      values (
        gen_random_uuid(),
        (
          select id
          from creator_identities
          where user_id = ${input.userId}
        ),
        'youtube',
        ${input.channel.id},
        ${input.channel.login},
        ${input.channel.displayName},
        ${input.token.scopes},
        ${input.encryptedAccessToken},
        ${input.encryptedRefreshToken},
        ${input.token.expiresAt},
        null,
        now()
      )
      on conflict (provider, external_channel_id) do update
      set
        external_login = excluded.external_login,
        channel_name = excluded.channel_name,
        scopes = excluded.scopes,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        token_expires_at = excluded.token_expires_at,
        disconnected_at = null,
        updated_at = now()
      where
        streaming_connections.creator_identity_id =
        excluded.creator_identity_id
      returning
        id,
        external_channel_id,
        external_login,
        channel_name,
        connected_at
    `;
    const row = rows[0];
    if (!row) {
      throw new Error("YouTube channel is already connected to another account");
    }
    return toConnectedYoutubeChannel(row);
  }

  async findYoutubeConnection(
    userId: string,
  ): Promise<ConnectedYoutubeChannel | null> {
    const rows = await this.sql<ConnectionRow[]>`
      select
        streaming_connections.id,
        streaming_connections.external_channel_id,
        streaming_connections.external_login,
        streaming_connections.channel_name,
        streaming_connections.connected_at
      from streaming_connections
      join creator_identities identities
        on identities.id = streaming_connections.creator_identity_id
      where identities.user_id = ${userId}
        and streaming_connections.provider = 'youtube'
        and streaming_connections.disconnected_at is null
      order by streaming_connections.updated_at desc
      limit 1
    `;
    return rows[0] ? toConnectedYoutubeChannel(rows[0]) : null;
  }

  async disconnectYoutube(userId: string, now: Date): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const identities = await transaction<Array<{ id: string }>>`
        select id from creator_identities where user_id = ${userId}
      `;
      const creatorIdentityId = identities[0]?.id;
      if (!creatorIdentityId) return;
      await transaction`
        update streaming_connections
        set
          disconnected_at = ${now},
          access_token_ciphertext = null,
          refresh_token_ciphertext = null,
          token_expires_at = null,
          updated_at = ${now}
        where creator_identity_id = ${creatorIdentityId}
          and provider = 'youtube'
          and disconnected_at is null
      `;
    });
  }

  async listYoutubeCredentials(): Promise<StoredYoutubeCredential[]> {
    const rows = await this.sql<
      Array<{
        id: string;
        external_channel_id: string;
        access_token_ciphertext: string;
        refresh_token_ciphertext: string;
        token_expires_at: Date;
      }>
    >`
      select
        id,
        external_channel_id,
        access_token_ciphertext,
        refresh_token_ciphertext,
        token_expires_at
      from streaming_connections
      where provider = 'youtube'
        and disconnected_at is null
        and access_token_ciphertext is not null
        and refresh_token_ciphertext is not null
        and token_expires_at is not null
    `;
    return rows.map((row) => ({
      connectionId: row.id,
      externalChannelId: row.external_channel_id,
      encryptedAccessToken: row.access_token_ciphertext,
      encryptedRefreshToken: row.refresh_token_ciphertext,
      expiresAt: row.token_expires_at,
    }));
  }

  async updateYoutubeCredential(
    connectionId: string,
    input: {
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      expiresAt: Date;
      scopes: string[];
    },
  ) {
    await this.sql`
      update streaming_connections
      set
        access_token_ciphertext = ${input.encryptedAccessToken},
        refresh_token_ciphertext = ${input.encryptedRefreshToken},
        token_expires_at = ${input.expiresAt},
        scopes = ${input.scopes},
        updated_at = now()
      where id = ${connectionId}
        and provider = 'youtube'
        and disconnected_at is null
    `;
  }

  async invalidateYoutubeConnection(connectionId: string, now: Date) {
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ creator_identity_id: string }>>`
        update streaming_connections
        set
          disconnected_at = ${now},
          access_token_ciphertext = null,
          refresh_token_ciphertext = null,
          token_expires_at = null,
          updated_at = ${now}
        where id = ${connectionId}
        returning creator_identity_id
      `;
      if (rows[0]) {
        await transaction`
          update overlay_configurations
          set
            public_token_hash = 'revoked:' || gen_random_uuid()::text,
            updated_at = ${now}
          where creator_identity_id = ${rows[0].creator_identity_id}
        `;
      }
    });
  }
}

function toConnectedChannel(row: ConnectionRow): ConnectedChannel {
  return {
    connectionId: row.id,
    id: row.external_channel_id,
    login: row.external_login ?? row.channel_name.toLowerCase(),
    displayName: row.channel_name,
    connectedAt: row.connected_at,
  };
}

function toConnectedYoutubeChannel(
  row: ConnectionRow,
): ConnectedYoutubeChannel {
  return {
    connectionId: row.id,
    id: row.external_channel_id,
    login: row.external_login ?? row.channel_name,
    displayName: row.channel_name,
    connectedAt: row.connected_at,
  };
}

type CommandRow = {
  id: string;
  creator_identity_id: string;
  connection_id: string;
  provider: string;
  trigger: string;
  response_template: string;
  access_level: "everyone" | "moderators" | "creator";
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

type OverlayRow = {
  id: string;
  visible_fields: OverlayField[];
  theme: "dark";
  created_at: Date;
  updated_at: Date;
};

type PublicOverlayRow = OverlayRow & {
  creator_identity_id: string;
  state: PublicStreamState | null;
  revision: string | number | null;
  state_updated_at: Date | null;
};

export class PostgresCreatorFeaturesRepository
  implements CreatorFeaturesRepository
{
  constructor(private readonly sql: Sql) {}

  async listAccessibleCreators(actorUserId: string) {
    return this.sql<
      Array<{
        creatorIdentityId: string;
        role: CreatorRole;
        channelName: string | null;
        provider: string | null;
      }>
    >`
      select
        identities.id as "creatorIdentityId",
        case
          when identities.user_id = ${actorUserId} then 'owner'
          else 'moderator'
        end as role,
        connections.channel_name as "channelName",
        connections.provider
      from creator_identities identities
      left join lateral (
        select channel_name, provider
        from streaming_connections
        where creator_identity_id = identities.id
          and disconnected_at is null
        order by updated_at desc
        limit 1
      ) connections on true
      where identities.user_id = ${actorUserId}
        -- Same 30-minute moderator badge freshness window as
        -- resolveCreatorRole in postgres-roles.ts. This listing query is
        -- shaped differently (EXISTS over all creators vs. a single-creator
        -- role lookup) so it isn't sharing that helper directly, but any
        -- change to the moderator policy must be mirrored here too.
        or exists (
          select 1
          from creator_subscriptions subscriptions
          join event_profiles profiles
            on profiles.creator_identity_id = identities.id
          join event_moderator_badges badges
            on badges.profile_id = profiles.id
            and badges.verified_at >= now() - interval '30 minutes'
          join creator_identities actor_identity
            on actor_identity.user_id = ${actorUserId}
          join streaming_connections actor_connection
            on actor_connection.creator_identity_id = actor_identity.id
            and actor_connection.provider = badges.provider
            and actor_connection.external_channel_id = badges.external_user_id
            and actor_connection.disconnected_at is null
          where subscriptions.creator_identity_id = identities.id
            and subscriptions.status = 'active'
            and (
              subscriptions.expires_at is null
              or subscriptions.expires_at > now()
            )
        )
      order by role, connections.channel_name nulls last
    `;
  }

  resolveRole(
    actorUserId: string,
    creatorIdentityId: string,
  ): Promise<CreatorRole | null> {
    return resolveCreatorRole(this.sql, actorUserId, creatorIdentityId);
  }

  async findActiveConnectionId(
    creatorIdentityId: string,
    provider: string,
  ): Promise<string | null> {
    const rows = await this.sql<Array<{ id: string }>>`
      select id
      from streaming_connections
      where creator_identity_id = ${creatorIdentityId}
        and provider = ${provider}
        and disconnected_at is null
      order by updated_at desc
      limit 1
    `;
    return rows[0]?.id ?? null;
  }

  async listCommands(
    creatorIdentityId: string,
  ): Promise<StreamingCommand[]> {
    const rows = await this.sql<CommandRow[]>`
      select
        commands.id,
        commands.creator_identity_id,
        commands.connection_id,
        connections.provider,
        commands.trigger,
        commands.response_template,
        commands.access_level,
        commands.enabled,
        commands.created_at,
        commands.updated_at
      from streaming_commands commands
      join streaming_connections connections
        on connections.id = commands.connection_id
      where commands.creator_identity_id = ${creatorIdentityId}
      order by connections.provider, commands.trigger
    `;
    return rows.map(toCommand);
  }

  async findCommandForChannel(
    provider: string,
    externalChannelId: string,
    trigger: string,
  ): Promise<StreamingCommand | null> {
    const rows = await this.sql<CommandRow[]>`
      select
        commands.id,
        commands.creator_identity_id,
        commands.connection_id,
        connections.provider,
        commands.trigger,
        commands.response_template,
        commands.access_level,
        commands.enabled,
        commands.created_at,
        commands.updated_at
      from streaming_commands commands
      join streaming_connections connections
        on connections.id = commands.connection_id
      -- Entitlement is per creator, not per platform: a subscription
      -- anchored to whichever connection existed at grant time must still
      -- unlock commands/events on every platform the creator has since
      -- connected (e.g. granted via Twitch, later also connects YouTube).
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id =
          commands.creator_identity_id
        and subscriptions.status = 'active'
        and (
          subscriptions.expires_at is null
          or subscriptions.expires_at > now()
        )
      where connections.provider = ${provider}
        and connections.external_channel_id = ${externalChannelId}
        and connections.disconnected_at is null
        and commands.trigger = ${trigger}
        and commands.enabled = true
      limit 1
    `;
    return rows[0] ? toCommand(rows[0]) : null;
  }

  async findLatestOverlayState(
    creatorIdentityId: string,
  ): Promise<PublicStreamState> {
    const rows = await this.sql<Array<{ state: PublicStreamState }>>`
      select state
      from overlay_states
      where creator_identity_id = ${creatorIdentityId}
      limit 1
    `;
    return rows[0]?.state ?? {
      activity: null,
      pack: null,
      dungeon: null,
      nextDungeon: null,
      dailyQuest: null,
      inventoryChests: 0,
      timerSeconds: 0,
      packsDone: 0,
      packsTotal: 0,
      dungeonsDone: 0,
      dungeonsTotal: 0,
      chests: 0,
      farmTimeSeconds: 0,
      server: null,
      player: null,
    };
  }

  async acquireCommandCooldown(input: {
    commandId: string;
    channelId: string;
    chatterUserId: string;
    now: Date;
    channelWindowMs: number;
    userWindowMs: number;
  }) {
    return this.sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${input.commandId}, 0)
        )
      `;
      const scopes = [
        {
          key: `channel:${input.channelId}`,
          availableAt: new Date(
            input.now.getTime() + input.channelWindowMs,
          ),
        },
        {
          key: `user:${input.channelId}:${input.chatterUserId}`,
          availableAt: new Date(
            input.now.getTime() + input.userWindowMs,
          ),
        },
      ];
      const locked = await transaction<
        Array<{ scope_key: string; available_at: Date }>
      >`
        select scope_key, available_at
        from command_cooldowns
        where command_id = ${input.commandId}
          and scope_key in ${transaction(
            scopes.map((scope) => scope.key),
          )}
        for update
      `;
      if (
        locked.some(
          (row) => row.available_at.getTime() > input.now.getTime(),
        )
      ) {
        return false;
      }
      for (const scope of scopes) {
        await transaction`
          insert into command_cooldowns (
            command_id,
            scope_key,
            available_at
          )
          values (
            ${input.commandId},
            ${scope.key},
            ${scope.availableAt}
          )
          on conflict (command_id, scope_key) do update
          set available_at = excluded.available_at
        `;
      }
      return true;
    });
  }

  async createCommand(
    creatorIdentityId: string,
    connectionId: string,
    actorUserId: string,
    input: {
      trigger: string;
      responseTemplate: string;
      accessLevel: "everyone" | "moderators" | "creator";
      enabled: boolean;
    },
  ): Promise<StreamingCommand> {
    const rows = await this.sql<CommandRow[]>`
      with inserted as (
        insert into streaming_commands (
          creator_identity_id,
          connection_id,
          trigger,
          response_template,
          access_level,
          enabled,
          created_by_user_id
        )
        values (
          ${creatorIdentityId},
          ${connectionId},
          ${input.trigger},
          ${input.responseTemplate},
          ${input.accessLevel},
          ${input.enabled},
          ${actorUserId}
        )
        returning *
      )
      select
        inserted.id,
        inserted.creator_identity_id,
        inserted.connection_id,
        connections.provider,
        inserted.trigger,
        inserted.response_template,
        inserted.access_level,
        inserted.enabled,
        inserted.created_at,
        inserted.updated_at
      from inserted
      join streaming_connections connections
        on connections.id = inserted.connection_id
    `;
    return toCommand(rows[0]!);
  }

  async updateCommand(
    creatorIdentityId: string,
    commandId: string,
    input: {
      trigger: string;
      responseTemplate: string;
      accessLevel: "everyone" | "moderators" | "creator";
      enabled: boolean;
    },
  ): Promise<StreamingCommand | null> {
    const rows = await this.sql<CommandRow[]>`
      with updated as (
        update streaming_commands
        set
          trigger = ${input.trigger},
          response_template = ${input.responseTemplate},
          access_level = ${input.accessLevel},
          enabled = ${input.enabled},
          updated_at = now()
        where id = ${commandId}
          and creator_identity_id = ${creatorIdentityId}
        returning *
      )
      select
        updated.id,
        updated.creator_identity_id,
        updated.connection_id,
        connections.provider,
        updated.trigger,
        updated.response_template,
        updated.access_level,
        updated.enabled,
        updated.created_at,
        updated.updated_at
      from updated
      join streaming_connections connections
        on connections.id = updated.connection_id
    `;
    return rows[0] ? toCommand(rows[0]) : null;
  }

  async deleteCommand(
    creatorIdentityId: string,
    commandId: string,
  ): Promise<boolean> {
    const result = await this.sql`
      delete from streaming_commands
      where id = ${commandId}
        and creator_identity_id = ${creatorIdentityId}
    `;
    return result.count > 0;
  }

  async upsertOverlayConfiguration(
    creatorIdentityId: string,
    publicTokenHash: string | null,
    fields: OverlayField[],
  ): Promise<OverlayConfiguration> {
    const rows = await this.sql<OverlayRow[]>`
      insert into overlay_configurations (
        creator_identity_id,
        public_token_hash,
        visible_fields
      )
      values (
        ${creatorIdentityId},
        ${publicTokenHash ?? ""},
        ${this.sql.json(fields)}
      )
      on conflict (creator_identity_id) do update
      set
        public_token_hash = case
          when ${publicTokenHash}::text is null
            then overlay_configurations.public_token_hash
          else excluded.public_token_hash
        end,
        visible_fields = excluded.visible_fields,
        updated_at = now()
      returning id, visible_fields, theme, created_at, updated_at
    `;
    return toOverlayConfiguration(rows[0]!);
  }

  async hasOverlayConfiguration(creatorIdentityId: string) {
    const rows = await this.sql<Array<{ exists: boolean }>>`
      select exists (
        select 1
        from overlay_configurations
        where creator_identity_id = ${creatorIdentityId}
      ) as exists
    `;
    return rows[0]?.exists ?? false;
  }

  async findOverlayConfiguration(creatorIdentityId: string) {
    const rows = await this.sql<OverlayRow[]>`
      select id, visible_fields, theme, created_at, updated_at
      from overlay_configurations
      where creator_identity_id = ${creatorIdentityId}
      limit 1
    `;
    return rows[0] ? toOverlayConfiguration(rows[0]) : null;
  }

  async updateOverlayState(
    creatorIdentityId: string,
    state: PublicStreamState,
  ): Promise<{ revision: number; updatedAt: Date }> {
    const rows = await this.sql<
      Array<{ revision: string | number; updatedAt: Date }>
    >`
      insert into overlay_states (
        creator_identity_id,
        state,
        revision
      )
      values (
        ${creatorIdentityId},
        ${this.sql.json(state)},
        1
      )
      on conflict (creator_identity_id) do update
      set
        state = excluded.state,
        revision = overlay_states.revision + 1,
        updated_at = now()
      returning revision, updated_at as "updatedAt"
    `;
    return {
      revision: Number(rows[0]!.revision),
      updatedAt: rows[0]!.updatedAt,
    };
  }

  async findOverlayByTokenHash(
    tokenHash: string,
  ): Promise<PublicOverlaySnapshot | null> {
    const rows = await this.sql<PublicOverlayRow[]>`
      select
        config.id,
        config.creator_identity_id,
        config.visible_fields,
        config.theme,
        config.created_at,
        config.updated_at,
        state.state,
        state.revision,
        state.updated_at as state_updated_at
      from overlay_configurations config
      join creator_subscriptions subscriptions
        on subscriptions.creator_identity_id =
          config.creator_identity_id
        and subscriptions.status = 'active'
        and (
          subscriptions.expires_at is null
          or subscriptions.expires_at > now()
        )
        -- Any currently-connected platform satisfies entitlement, not
        -- specifically the one subscriptions.streaming_connection_id
        -- happened to point at when the subscription was granted -- that
        -- value is never updated afterwards, so matching on it directly
        -- would silently break the public overlay the moment a creator
        -- disconnects that one platform while still having another live.
        and exists (
          select 1
          from streaming_connections entitled_connection
          where entitled_connection.creator_identity_id =
            config.creator_identity_id
            and entitled_connection.disconnected_at is null
        )
      left join overlay_states state
        on state.creator_identity_id = config.creator_identity_id
      where config.public_token_hash = ${tokenHash}
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      creatorIdentityId: row.creator_identity_id,
      configuration: toOverlayConfiguration(row),
      state: row.state ?? {
        activity: null,
        pack: null,
        dungeon: null,
        nextDungeon: null,
        dailyQuest: null,
        inventoryChests: 0,
        timerSeconds: 0,
        packsDone: 0,
        packsTotal: 0,
        dungeonsDone: 0,
        dungeonsTotal: 0,
        chests: 0,
        farmTimeSeconds: 0,
        server: null,
        player: null,
      },
      revision: Number(row.revision ?? 0),
      updatedAt: row.state_updated_at ?? row.updated_at,
    };
  }
}

function toCommand(row: CommandRow): StreamingCommand {
  return {
    id: row.id,
    creatorIdentityId: row.creator_identity_id,
    connectionId: row.connection_id,
    provider: row.provider,
    trigger: row.trigger,
    responseTemplate: row.response_template,
    accessLevel: row.access_level,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOverlayConfiguration(row: OverlayRow): OverlayConfiguration {
  return {
    id: row.id,
    visibleFields: row.visible_fields,
    theme: row.theme,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type AdminCreatorRow = {
  user_id: string;
  email: string;
  creator_identity_id: string;
  streaming_provider: string | null;
  streaming_channel_id: string | null;
  streaming_channel_name: string | null;
  subscription_id: string | null;
  plan_type: SubscriptionPlan | null;
  subscription_status: SubscriptionStatus | null;
  subscription_source: SubscriptionSource | null;
  subscription_created_at: Date | null;
  subscription_expires_at: Date | null;
};

export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly sql: Sql) {}

  async searchCreatorRecords(query: string) {
    const value = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = await this.sql<AdminCreatorRow[]>`
      ${adminCreatorSelect(this.sql)}
      where
        accounts.email ilike ${value} escape '\'
        or connections.channel_name ilike ${value} escape '\'
        or connections.external_channel_id = ${query}
      order by accounts.email
      limit 30
    `;
    return rows.map(toAdminCreatorRecord);
  }

  async findCreatorRecord(userId: string) {
    const rows = await this.sql<AdminCreatorRow[]>`
      ${adminCreatorSelect(this.sql)}
      where accounts.id = ${userId}
      limit 1
    `;
    return rows[0] ? toAdminCreatorRecord(rows[0]) : null;
  }

  async grantLifetime(input: {
    userId: string;
    adminSubject: string;
    source: SubscriptionSource;
    reason: string;
    now: Date;
  }) {
    await this.sql.begin(async (transaction) => {
      const identities = await transaction<Array<{ id: string }>>`
        select id from creator_identities where user_id = ${input.userId}
      `;
      const creatorIdentityId = identities[0]?.id;
      if (!creatorIdentityId) throw new Error("Creator identity not found");
      const connections = await transaction<Array<{ id: string }>>`
        select id
        from streaming_connections
        where creator_identity_id = ${creatorIdentityId}
          and disconnected_at is null
        order by updated_at desc
        limit 1
      `;
      const streamingConnectionId = connections[0]?.id;
      if (!streamingConnectionId) {
        throw new AdminStreamingConnectionRequiredError();
      }
      await transaction`
        update creator_subscriptions
        set status = 'cancelled', updated_at = ${input.now}
        where creator_identity_id = ${creatorIdentityId}
          and status = 'active'
      `;
      const subscriptions = await transaction<Array<{ id: string }>>`
        insert into creator_subscriptions (
          id,
          user_id,
          creator_identity_id,
          streaming_connection_id,
          plan_type,
          status,
          source,
          created_at,
          updated_at,
          expires_at
        )
        values (
          gen_random_uuid(),
          ${input.userId},
          ${creatorIdentityId},
          ${streamingConnectionId},
          'lifetime',
          'active',
          ${input.source},
          ${input.now},
          ${input.now},
          null
        )
        returning id
      `;
      await transaction`
        insert into admin_audit_events (
          id,
          admin_subject,
          action,
          target_subscription_id,
          reason,
          payload
        )
        values (
          gen_random_uuid(),
          ${input.adminSubject},
          'creator.grant_lifetime',
          ${subscriptions[0]!.id},
          ${input.reason},
          ${transaction.json({ source: input.source })}
        )
      `;
    });
  }

  async changeSubscription(input: {
    subscriptionId: string;
    plan: SubscriptionPlan;
    expiresAt: Date | null;
    adminSubject: string;
    reason: string;
    now: Date;
  }) {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ id: string }>>`
        update creator_subscriptions
        set
          plan_type = ${input.plan},
          status = 'active',
          expires_at = ${input.expiresAt},
          updated_at = ${input.now}
        where id = ${input.subscriptionId}
        returning id
      `;
      if (!rows[0]) return false;
      await transaction`
        insert into admin_audit_events (
          id,
          admin_subject,
          action,
          target_subscription_id,
          reason,
          payload
        )
        values (
          gen_random_uuid(),
          ${input.adminSubject},
          'creator.change_plan',
          ${input.subscriptionId},
          ${input.reason},
          ${transaction.json({
            plan: input.plan,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          })}
        )
      `;
      return true;
    });
  }

  async cancelSubscription(input: {
    subscriptionId: string;
    adminSubject: string;
    reason: string;
    now: Date;
  }) {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<Array<{ id: string }>>`
        update creator_subscriptions
        set status = 'cancelled', updated_at = ${input.now}
        where id = ${input.subscriptionId}
          and status <> 'cancelled'
        returning id
      `;
      if (!rows[0]) return false;
      await transaction`
        insert into admin_audit_events (
          id,
          admin_subject,
          action,
          target_subscription_id,
          reason
        )
        values (
          gen_random_uuid(),
          ${input.adminSubject},
          'creator.cancel',
          ${input.subscriptionId},
          ${input.reason}
        )
      `;
      return true;
    });
  }
}

function adminCreatorSelect(sql: Sql) {
  return sql`
    select
      accounts.id as user_id,
      accounts.email,
      identities.id as creator_identity_id,
      connections.provider as streaming_provider,
      connections.external_channel_id as streaming_channel_id,
      connections.channel_name as streaming_channel_name,
      subscriptions.id as subscription_id,
      subscriptions.plan_type,
      subscriptions.status as subscription_status,
      subscriptions.source as subscription_source,
      subscriptions.created_at as subscription_created_at,
      subscriptions.expires_at as subscription_expires_at
    from castaryn_accounts accounts
    join creator_identities identities
      on identities.user_id = accounts.id
    -- Not scoped to a single provider: a creator may only have connected
    -- YouTube (no Twitch at all) -- restricting to Twitch here would hide
    -- the channel info for YouTube-only creators.
    left join lateral (
      select provider, external_channel_id, channel_name
      from streaming_connections
      where creator_identity_id = identities.id
        and disconnected_at is null
      order by updated_at desc
      limit 1
    ) connections on true
    -- Scoped only to the creator, not to whichever connection the lateral
    -- above happened to pick: a subscription's streaming_connection_id
    -- records whichever platform was active at grant time and is never
    -- updated afterwards, so matching on it would make an admin see "no
    -- subscription" for a creator who simply connected/disconnected a
    -- different platform since then.
    left join lateral (
      select id, plan_type, status, source, created_at, expires_at
      from creator_subscriptions
      where creator_identity_id = identities.id
      order by created_at desc
      limit 1
    ) subscriptions on true
  `;
}

function toAdminCreatorRecord(row: AdminCreatorRow): AdminCreatorRecord {
  return {
    userId: row.user_id,
    email: row.email,
    creatorIdentityId: row.creator_identity_id,
    streamingProvider: row.streaming_provider,
    streamingChannelId: row.streaming_channel_id,
    streamingChannelName: row.streaming_channel_name,
    subscription:
      row.subscription_id &&
      row.plan_type &&
      row.subscription_status &&
      row.subscription_source &&
      row.subscription_created_at
        ? {
            id: row.subscription_id,
            plan: row.plan_type,
            status: row.subscription_status,
            source: row.subscription_source,
            createdAt: row.subscription_created_at,
            expiresAt: row.subscription_expires_at,
          }
        : null,
  };
}
