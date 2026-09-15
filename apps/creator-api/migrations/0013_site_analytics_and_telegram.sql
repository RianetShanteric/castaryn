create table if not exists site_page_views (
  id bigint generated always as identity primary key,
  visited_on date not null,
  visitor_hash char(64) not null,
  path text not null,
  referrer_host text,
  created_at timestamptz not null default now(),
  check (char_length(path) between 1 and 160),
  check (referrer_host is null or char_length(referrer_host) between 1 and 253)
);

create index if not exists site_page_views_created_idx
  on site_page_views (created_at desc);

create index if not exists site_page_views_unique_idx
  on site_page_views (visited_on, visitor_hash);

create table if not exists telegram_alert_states (
  alert_key text primary key,
  is_active boolean not null,
  changed_at timestamptz not null default now(),
  last_notified_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  check (char_length(alert_key) between 1 and 64)
);
