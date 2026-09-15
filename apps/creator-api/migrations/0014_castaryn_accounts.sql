alter table if exists elyvo_accounts
  rename to castaryn_accounts;

alter index if exists elyvo_accounts_external_identity_idx
  rename to castaryn_accounts_external_identity_idx;
