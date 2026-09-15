create table if not exists event_moderator_badges (
  profile_id uuid not null references event_profiles(id) on delete cascade,
  twitch_user_id text not null,
  display_name text not null,
  verified_at timestamptz not null,
  primary key (profile_id, twitch_user_id),
  check (twitch_user_id ~ '^[0-9]{1,32}$'),
  check (char_length(display_name) between 1 and 64)
);

create index if not exists event_moderator_badges_recent_idx
  on event_moderator_badges (twitch_user_id, verified_at desc);
