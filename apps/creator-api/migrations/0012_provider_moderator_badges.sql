alter table event_moderator_badges
  rename column twitch_user_id to external_user_id;

alter table event_moderator_badges
  add column if not exists provider text not null default 'twitch';

alter table event_moderator_badges
  alter column provider drop default;

alter table event_moderator_badges
  drop constraint if exists event_moderator_badges_pkey;

alter table event_moderator_badges
  add primary key (profile_id, provider, external_user_id);

alter table event_moderator_badges
  drop constraint if exists event_moderator_badges_twitch_user_id_check;

alter table event_moderator_badges
  add constraint event_moderator_badges_provider_check
  check (provider ~ '^[a-z][a-z0-9_-]{1,31}$');

alter table event_moderator_badges
  add constraint event_moderator_badges_external_user_id_check
  check (char_length(external_user_id) between 1 and 64);

drop index if exists event_moderator_badges_recent_idx;

create index if not exists event_moderator_badges_recent_idx
  on event_moderator_badges (provider, external_user_id, verified_at desc);
