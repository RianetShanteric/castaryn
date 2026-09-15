create table if not exists event_configurations (
  profile_id uuid not null references event_profiles(id) on delete cascade,
  event_id text not null,
  display_name text not null,
  command text not null,
  is_enabled boolean not null default true,
  show_in_catalog boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, event_id),
  check (char_length(event_id) between 1 and 48),
  check (char_length(display_name) between 1 and 40),
  check (char_length(command) between 2 and 32)
);

create unique index if not exists event_configurations_command_idx
  on event_configurations (profile_id, lower(command));
