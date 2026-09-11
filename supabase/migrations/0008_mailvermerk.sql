-- ============================================================
-- Lunar Events — Vermerk über verschickte Ticketmails
--
-- Zahlungsanbieter melden denselben Vorgang mehrfach, und die
-- Bestätigungsseite fragt zusätzlich selbst nach. Ohne Vermerk bekäme
-- ein Gast seine Tickets zwei- oder dreimal zugeschickt.
-- ============================================================

begin;

alter table bestellungen
  add column if not exists mail_gesendet_am timestamptz;

commit;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'bestellungen' and column_name = 'mail_gesendet_am'
  ) then
    raise exception 'Spalte mail_gesendet_am fehlt';
  end if;
end $$;
