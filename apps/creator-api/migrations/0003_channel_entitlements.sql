alter table elyvo_accounts
  add column if not exists external_issuer text,
  add column if not exists external_subject text,
  add column if not exists email_verified boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update elyvo_accounts
set
  external_issuer = coalesce(external_issuer, 'legacy'),
  external_subject = coalesce(external_subject, id::text),
  email_verified = true
where external_issuer is null
   or external_subject is null;

alter table elyvo_accounts
  alter column external_issuer set not null,
  alter column external_subject set not null;

create unique index if not exists elyvo_accounts_external_identity_idx
  on elyvo_accounts (external_issuer, external_subject);

alter table creator_subscriptions
  add column if not exists streaming_connection_id uuid
    references streaming_connections(id) on delete restrict;

update creator_subscriptions subscriptions
set streaming_connection_id = (
  select id
  from streaming_connections
  where creator_identity_id = subscriptions.creator_identity_id
  order by
    (disconnected_at is null) desc,
    updated_at desc
  limit 1
)
where subscriptions.streaming_connection_id is null;

drop index if exists creator_subscriptions_one_active_idx;

create unique index if not exists creator_subscriptions_one_active_channel_idx
  on creator_subscriptions (streaming_connection_id)
  where status = 'active' and streaming_connection_id is not null;

create index if not exists creator_subscriptions_identity_status_idx
  on creator_subscriptions (creator_identity_id, status, expires_at);

create index if not exists creator_subscriptions_connection_status_idx
  on creator_subscriptions (streaming_connection_id, status, expires_at);
