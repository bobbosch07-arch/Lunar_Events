-- ============================================================
-- Lunar Events — Zugang zu den eigenen Tickets ohne Anmeldung
--
-- Bisher hing der Zugang an einem Cookie, das vier Stunden hält. Wer
-- die Bestätigungsseite schließt und drei Wochen später vor der Tür
-- steht, kommt an seine Tickets nicht mehr heran — es sei denn, er hat
-- ein Konto.
--
-- Deshalb bekommt jede Bestellung eine lange Zufallskennung. Der Link
-- mit dieser Kennung ist der Ticketzugang: Er steht in der Mail, lässt
-- sich speichern und weitergeben. Genau wie ein Ticket selbst.
-- ============================================================

begin;

alter table bestellungen
  add column if not exists zugangstoken text;

-- Zwei UUIDs ohne Bindestriche: 64 Hexzeichen. Nicht zu erraten, und
-- ohne Abhängigkeit von pgcrypto (siehe 0001).
update bestellungen
   set zugangstoken = replace(gen_random_uuid()::text, '-', '') ||
                      replace(gen_random_uuid()::text, '-', '')
 where zugangstoken is null;

alter table bestellungen
  alter column zugangstoken set default
    replace(gen_random_uuid()::text, '-', '') ||
    replace(gen_random_uuid()::text, '-', '');

alter table bestellungen
  alter column zugangstoken set not null;

create unique index if not exists bestellungen_zugangstoken_idx
  on bestellungen (zugangstoken);

-- Die Ticketansicht läuft serverseitig mit dem Dienstschlüssel; die
-- Zugriffsregeln bleiben deshalb unverändert. Der Token ist der
-- Nachweis, nicht eine Sitzung.

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  ohne int;
begin
  select count(*) into ohne from bestellungen where zugangstoken is null;
  if ohne > 0 then
    raise exception 'Es gibt % Bestellungen ohne Zugangskennung', ohne;
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'bestellungen_zugangstoken_idx'
  ) then
    raise exception 'Der Index auf die Zugangskennung fehlt';
  end if;
end $$;
