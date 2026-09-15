update castaryn_accounts
set external_issuer = 'https://control.castaryn.ru/auth/realms/castaryn',
    updated_at = now()
where external_issuer in (
  'https://elyvo.mooo.com/auth/realms/elyvo',
  'https://control.castaryn.ru/auth/realms/elyvo'
);
