alter table event_profiles
  add column if not exists is_enabled boolean not null default false,
  add column if not exists control_revision bigint not null default 0;

alter table streaming_connections
  add column if not exists eventsub_status text not null default 'pending',
  add column if not exists eventsub_checked_at timestamptz;

alter table streaming_connections
  drop constraint if exists streaming_connections_eventsub_status_check;

alter table streaming_connections
  add constraint streaming_connections_eventsub_status_check
  check (eventsub_status in ('pending', 'ready', 'failed'));

create table if not exists event_consumer_presence (
  profile_id uuid not null references event_profiles(id) on delete cascade,
  consumer_type text not null check (consumer_type in ('desktop', 'overlay')),
  consumer_id text not null,
  last_seen_at timestamptz not null default now(),
  last_ack_sequence bigint not null default 0,
  primary key (profile_id, consumer_type),
  check (char_length(consumer_id) between 8 and 96)
);

create index if not exists event_consumer_presence_seen_idx
  on event_consumer_presence (last_seen_at);

alter table event_effect_dispatches
  add column if not exists price bigint not null default 1000,
  add column if not exists is_test boolean not null default false,
  add column if not exists delivery_status text not null default 'queued',
  add column if not exists delivery_deadline timestamptz,
  add column if not exists overlay_acknowledged_at timestamptz,
  add column if not exists desktop_acknowledged_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update event_effect_dispatches
set delivery_deadline = created_at + interval '15 seconds'
where delivery_deadline is null;

-- Dispatches created before delivery acknowledgements existed must not be
-- mistaken for newly undelivered purchases and refunded after this migration.
update event_effect_dispatches
set
  delivery_status = 'acknowledged',
  overlay_acknowledged_at = coalesce(overlay_acknowledged_at, created_at)
where delivery_status = 'queued';

alter table event_effect_dispatches
  alter column delivery_deadline set not null;

alter table event_effect_dispatches
  drop constraint if exists event_effect_dispatches_delivery_status_check;

alter table event_effect_dispatches
  add constraint event_effect_dispatches_delivery_status_check
  check (
    delivery_status in (
      'queued',
      'acknowledged',
      'refunded',
      'cancelled'
    )
  );

create index if not exists event_effect_dispatches_pending_idx
  on event_effect_dispatches (delivery_deadline)
  where delivery_status = 'queued' and is_test = false;

create table if not exists event_balance_movements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references event_profiles(id) on delete cascade,
  viewer_key text not null,
  amount bigint not null check (amount <> 0),
  reason text not null
    check (reason in ('manual', 'event_purchase', 'event_refund')),
  dispatch_id uuid references event_effect_dispatches(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists event_balance_movements_refund_idx
  on event_balance_movements (dispatch_id, reason)
  where dispatch_id is not null and reason = 'event_refund';

create index if not exists event_balance_movements_profile_created_idx
  on event_balance_movements (profile_id, created_at desc);

create table if not exists creator_service_heartbeats (
  service_name text primary key,
  last_seen_at timestamptz not null,
  check (service_name in ('event_worker'))
);
