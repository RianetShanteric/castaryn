alter table external_event_inbox
  add column if not exists processing_started_at timestamptz;

create index if not exists external_event_inbox_processing_idx
  on external_event_inbox (processing_started_at)
  where status = 'processing';
