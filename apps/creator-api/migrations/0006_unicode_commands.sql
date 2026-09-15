alter table streaming_commands
  drop constraint if exists streaming_commands_trigger_check;

alter table streaming_commands
  add constraint streaming_commands_trigger_check
  check (
    char_length(trigger) between 2 and 32
    and trigger ~ '^![^[:space:]]{1,31}$'
  );
