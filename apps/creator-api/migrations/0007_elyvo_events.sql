create table if not exists event_profiles (
  id uuid primary key default gen_random_uuid(),
  creator_identity_id uuid not null references creator_identities(id) on delete cascade,
  connection_id uuid not null unique references streaming_connections(id) on delete cascade,
  name text not null,
  currency_name text not null default 'Баллы',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 80),
  check (char_length(currency_name) between 1 and 32)
);

create index if not exists event_profiles_creator_idx
  on event_profiles (creator_identity_id);

create table if not exists event_viewer_balances (
  profile_id uuid not null references event_profiles(id) on delete cascade,
  viewer_key text not null,
  external_viewer_id text,
  display_name text not null,
  balance bigint not null default 0 check (balance between 0 and 1000000000),
  updated_at timestamptz not null default now(),
  primary key (profile_id, viewer_key),
  check (viewer_key ~ '^[a-z0-9_.-]{1,64}$'),
  check (char_length(display_name) between 1 and 64)
);

create index if not exists event_viewer_balances_name_idx
  on event_viewer_balances (profile_id, lower(display_name));

create table if not exists event_cooldowns (
  profile_id uuid not null references event_profiles(id) on delete cascade,
  event_id text not null,
  available_at timestamptz not null,
  primary key (profile_id, event_id)
);

create table if not exists event_effect_dispatches (
  sequence bigserial primary key,
  id uuid not null unique default gen_random_uuid(),
  profile_id uuid not null references event_profiles(id) on delete cascade,
  event_id text not null,
  viewer_key text not null,
  viewer_name text not null,
  effect jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (char_length(event_id) between 1 and 48),
  check (char_length(viewer_name) between 1 and 64)
);

create index if not exists event_effect_dispatches_profile_sequence_idx
  on event_effect_dispatches (profile_id, sequence);

create index if not exists event_effect_dispatches_expiry_idx
  on event_effect_dispatches (expires_at);
