create table if not exists integration_oauth_states (
  state_hash text primary key,
  provider text not null,
  purpose text not null,
  initiated_by_subject text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists integration_oauth_states_expiry_idx
  on integration_oauth_states (expires_at);

create table if not exists streaming_bot_credentials (
  provider text primary key,
  external_user_id text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  scopes text[] not null,
  token_expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invalidated_at timestamptz
);

create table if not exists external_event_inbox (
  provider text not null,
  message_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received'
    check (
      status in (
        'received',
        'processing',
        'processed',
        'failed',
        'dead_letter'
      )
    ),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  primary key (provider, message_id)
);

create index if not exists external_event_inbox_pending_idx
  on external_event_inbox (available_at, received_at)
  where status in ('received', 'failed');

create table if not exists command_cooldowns (
  command_id uuid not null references streaming_commands(id) on delete cascade,
  scope_key text not null,
  available_at timestamptz not null,
  primary key (command_id, scope_key)
);
