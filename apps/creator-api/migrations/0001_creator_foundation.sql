create table if not exists elyvo_accounts (
  id uuid primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists creator_identities (
  id uuid primary key,
  user_id uuid not null unique references elyvo_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists streaming_connections (
  id uuid primary key,
  creator_identity_id uuid not null references creator_identities(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,31}$'),
  external_channel_id text not null,
  channel_name text not null,
  connected_at timestamptz not null default now(),
  unique (provider, external_channel_id)
);

create table if not exists creator_subscriptions (
  id uuid primary key,
  user_id uuid not null references elyvo_accounts(id) on delete cascade,
  creator_identity_id uuid not null,
  plan_type text not null check (plan_type in ('trial', 'monthly', 'yearly', 'lifetime')),
  status text not null check (status in ('active', 'expired', 'cancelled')),
  source text not null check (source in ('payment', 'developer_grant', 'gift')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  check (
    (plan_type = 'lifetime' and expires_at is null)
    or
    (plan_type <> 'lifetime' and expires_at is not null)
  ),
  foreign key (creator_identity_id, user_id)
    references creator_identities(id, user_id)
    on delete cascade
);

create index if not exists creator_subscriptions_user_created_idx
  on creator_subscriptions (user_id, created_at desc);

create unique index if not exists creator_subscriptions_one_active_idx
  on creator_subscriptions (creator_identity_id)
  where status = 'active';

create table if not exists moderator_assignments (
  id uuid primary key,
  creator_identity_id uuid not null references creator_identities(id) on delete cascade,
  moderator_user_id uuid not null references elyvo_accounts(id) on delete cascade,
  connection_id uuid references streaming_connections(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists moderator_assignments_scope_idx
  on moderator_assignments (
    creator_identity_id,
    moderator_user_id,
    coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists admin_audit_events (
  id uuid primary key,
  admin_subject text not null,
  action text not null,
  target_subscription_id uuid,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
