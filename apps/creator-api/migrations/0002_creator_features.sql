alter table streaming_connections
  add column if not exists external_login text,
  add column if not exists scopes text[] not null default '{}',
  add column if not exists access_token_ciphertext text,
  add column if not exists refresh_token_ciphertext text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists disconnected_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists oauth_connection_states (
  state_hash text primary key,
  user_id uuid not null references elyvo_accounts(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  return_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists oauth_connection_states_expiry_idx
  on oauth_connection_states (expires_at);

create table if not exists streaming_commands (
  id uuid primary key default gen_random_uuid(),
  creator_identity_id uuid not null references creator_identities(id) on delete cascade,
  connection_id uuid not null references streaming_connections(id) on delete cascade,
  trigger text not null,
  response_template text not null,
  access_level text not null check (access_level in ('everyone', 'moderators', 'creator')),
  enabled boolean not null default true,
  created_by_user_id uuid not null references elyvo_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, trigger),
  check (trigger ~ '^![[:alnum:]_]{1,31}$'),
  check (char_length(response_template) between 1 and 450)
);

create table if not exists overlay_configurations (
  id uuid primary key default gen_random_uuid(),
  creator_identity_id uuid not null unique references creator_identities(id) on delete cascade,
  public_token_hash text not null unique,
  visible_fields jsonb not null default '[]'::jsonb,
  theme text not null default 'dark' check (theme = 'dark'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists overlay_states (
  creator_identity_id uuid primary key references creator_identities(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists streaming_connections_identity_idx
  on streaming_connections (creator_identity_id, provider)
  where disconnected_at is null;

create index if not exists streaming_commands_connection_idx
  on streaming_commands (connection_id, enabled);
