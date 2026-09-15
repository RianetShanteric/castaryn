import type { Sql } from "postgres";
import type {
  StoredBotCredential,
  TwitchBotRepository,
} from "./twitch-bot.js";
import type {
  StoredYoutubeBotCredential,
  YoutubeBotRepository,
} from "./youtube-bot.js";
import type {
  EventInboxRepository,
  InboxEvent,
  JsonValue,
} from "./event-inbox.js";

type BotCredentialRow = {
  external_user_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string;
  scopes: string[];
  token_expires_at: Date;
  invalidated_at: Date | null;
};

export class PostgresTwitchBotRepository implements TwitchBotRepository {
  constructor(private readonly sql: Sql) {}

  async storeState(input: {
    stateHash: string;
    adminSubject: string;
    expiresAt: Date;
  }) {
    await this.sql`
      insert into integration_oauth_states (
        state_hash,
        provider,
        purpose,
        initiated_by_subject,
        expires_at
      )
      values (
        ${input.stateHash},
        'twitch',
        'bot_authorization',
        ${input.adminSubject},
        ${input.expiresAt}
      )
    `;
  }

  async consumeState(stateHash: string, now: Date) {
    const rows = await this.sql<Array<{ state_hash: string }>>`
      update integration_oauth_states
      set consumed_at = ${now}
      where state_hash = ${stateHash}
        and provider = 'twitch'
        and purpose = 'bot_authorization'
        and consumed_at is null
        and expires_at > ${now}
      returning state_hash
    `;
    return rows.length === 1;
  }

  async upsertCredential(input: {
    externalUserId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    scopes: string[];
    expiresAt: Date;
  }) {
    await this.sql`
      insert into streaming_bot_credentials (
        provider,
        external_user_id,
        access_token_ciphertext,
        refresh_token_ciphertext,
        scopes,
        token_expires_at,
        invalidated_at,
        updated_at
      )
      values (
        'twitch',
        ${input.externalUserId},
        ${input.encryptedAccessToken},
        ${input.encryptedRefreshToken},
        ${input.scopes},
        ${input.expiresAt},
        null,
        now()
      )
      on conflict (provider) do update
      set
        external_user_id = excluded.external_user_id,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        scopes = excluded.scopes,
        token_expires_at = excluded.token_expires_at,
        invalidated_at = null,
        updated_at = now()
    `;
  }

  async findCredential(): Promise<StoredBotCredential | null> {
    const rows = await this.sql<BotCredentialRow[]>`
      select
        external_user_id,
        access_token_ciphertext,
        refresh_token_ciphertext,
        scopes,
        token_expires_at,
        invalidated_at
      from streaming_bot_credentials
      where provider = 'twitch'
      limit 1
    `;
    const row = rows[0];
    return row
      ? {
          externalUserId: row.external_user_id,
          encryptedAccessToken: row.access_token_ciphertext,
          encryptedRefreshToken: row.refresh_token_ciphertext,
          scopes: row.scopes,
          expiresAt: row.token_expires_at,
          invalidatedAt: row.invalidated_at,
        }
      : null;
  }

  async invalidateCredential(now: Date) {
    await this.sql`
      update streaming_bot_credentials
      set invalidated_at = ${now}, updated_at = ${now}
      where provider = 'twitch'
    `;
  }
}

export class PostgresYoutubeBotRepository implements YoutubeBotRepository {
  constructor(private readonly sql: Sql) {}

  async storeState(input: {
    stateHash: string;
    adminSubject: string;
    expiresAt: Date;
  }) {
    await this.sql`
      insert into integration_oauth_states (
        state_hash,
        provider,
        purpose,
        initiated_by_subject,
        expires_at
      )
      values (
        ${input.stateHash},
        'youtube',
        'bot_authorization',
        ${input.adminSubject},
        ${input.expiresAt}
      )
    `;
  }

  async consumeState(stateHash: string, now: Date) {
    const rows = await this.sql<Array<{ state_hash: string }>>`
      update integration_oauth_states
      set consumed_at = ${now}
      where state_hash = ${stateHash}
        and provider = 'youtube'
        and purpose = 'bot_authorization'
        and consumed_at is null
        and expires_at > ${now}
      returning state_hash
    `;
    return rows.length === 1;
  }

  async upsertCredential(input: {
    externalUserId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    scopes: string[];
    expiresAt: Date;
  }) {
    await this.sql`
      insert into streaming_bot_credentials (
        provider,
        external_user_id,
        access_token_ciphertext,
        refresh_token_ciphertext,
        scopes,
        token_expires_at,
        invalidated_at,
        updated_at
      )
      values (
        'youtube',
        ${input.externalUserId},
        ${input.encryptedAccessToken},
        ${input.encryptedRefreshToken},
        ${input.scopes},
        ${input.expiresAt},
        null,
        now()
      )
      on conflict (provider) do update
      set
        external_user_id = excluded.external_user_id,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        scopes = excluded.scopes,
        token_expires_at = excluded.token_expires_at,
        invalidated_at = null,
        updated_at = now()
    `;
  }

  async findCredential(): Promise<StoredYoutubeBotCredential | null> {
    const rows = await this.sql<BotCredentialRow[]>`
      select
        external_user_id,
        access_token_ciphertext,
        refresh_token_ciphertext,
        scopes,
        token_expires_at,
        invalidated_at
      from streaming_bot_credentials
      where provider = 'youtube'
      limit 1
    `;
    const row = rows[0];
    return row
      ? {
          externalUserId: row.external_user_id,
          encryptedAccessToken: row.access_token_ciphertext,
          encryptedRefreshToken: row.refresh_token_ciphertext,
          scopes: row.scopes,
          expiresAt: row.token_expires_at,
          invalidatedAt: row.invalidated_at,
        }
      : null;
  }

  async invalidateCredential(now: Date) {
    await this.sql`
      update streaming_bot_credentials
      set invalidated_at = ${now}, updated_at = ${now}
      where provider = 'youtube'
    `;
  }
}

type InboxRow = {
  provider: string;
  message_id: string;
  event_type: string;
  payload: JsonValue;
  attempts: number;
};

export class PostgresEventInboxRepository
  implements EventInboxRepository
{
  constructor(private readonly sql: Sql) {}

  async enqueue(input: {
    provider: string;
    messageId: string;
    eventType: string;
    payload: JsonValue;
  }) {
    const result = await this.sql`
      insert into external_event_inbox (
        provider,
        message_id,
        event_type,
        payload
      )
      values (
        ${input.provider},
        ${input.messageId},
        ${input.eventType},
        ${this.sql.json(input.payload)}
      )
      on conflict (provider, message_id) do nothing
    `;
    return result.count === 1;
  }

  async claim(now: Date, limit: number): Promise<InboxEvent[]> {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<InboxRow[]>`
        with pending as (
          select provider, message_id
          from external_event_inbox
          where (
              status in ('received', 'failed')
              and available_at <= ${now}
            )
            or (
              status = 'processing'
              and processing_started_at < ${now} - interval '5 minutes'
            )
          order by received_at
          for update skip locked
          limit ${Math.max(1, Math.min(100, limit))}
        )
        update external_event_inbox events
        set
          status = 'processing',
          attempts = events.attempts + 1,
          processing_started_at = ${now}
        from pending
        where events.provider = pending.provider
          and events.message_id = pending.message_id
        returning
          events.provider,
          events.message_id,
          events.event_type,
          events.payload,
          events.attempts
      `;
      return rows.map((row) => ({
        provider: row.provider,
        messageId: row.message_id,
        eventType: row.event_type,
        payload: row.payload,
        attempts: row.attempts,
      }));
    });
  }

  async markProcessed(
    provider: string,
    messageId: string,
    processedAt: Date,
  ) {
    await this.sql`
      update external_event_inbox
      set
        status = 'processed',
        processed_at = ${processedAt},
        processing_started_at = null,
        last_error_code = null
      where provider = ${provider}
        and message_id = ${messageId}
    `;
  }

  async markFailed(input: {
    provider: string;
    messageId: string;
    availableAt: Date;
    errorCode: string;
    deadLetter: boolean;
  }) {
    await this.sql`
      update external_event_inbox
      set
        status = ${input.deadLetter ? "dead_letter" : "failed"},
        available_at = ${input.availableAt},
        processing_started_at = null,
        last_error_code = ${input.errorCode}
      where provider = ${input.provider}
        and message_id = ${input.messageId}
    `;
  }

  async cleanup(now: Date) {
    await this.sql.begin(async (transaction) => {
      await transaction`
        delete from integration_oauth_states
        where expires_at < ${now} - interval '1 day'
      `;
      await transaction`
        delete from external_event_inbox
        where
          (status = 'processed' and processed_at < ${now} - interval '7 days')
          or
          (status = 'dead_letter' and received_at < ${now} - interval '30 days')
      `;
      await transaction`
        delete from command_cooldowns
        where available_at < ${now} - interval '1 day'
      `;
      await transaction`
        delete from event_cooldowns
        where available_at < ${now} - interval '1 day'
      `;
      await transaction`
        delete from event_effect_dispatches
        where expires_at < ${now} - interval '1 day'
      `;
    });
  }
}
