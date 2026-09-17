-- ============================================================
-- Lunar Events — Promoter
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Promoter werden nicht bezahlt, nur gezählt.
--   * Jeder hat einen geheimen Statistik-Link ohne Anmeldung. Dort sieht er
--     verkaufte Tickets und Klicks auf seinen Link je Event — keinen
--     Umsatz, keine Namen.
--   * Rabatt je Promoter: über Rabattcodes, die ihm zugeordnet sind
--     (rabattcodes.promoter_id). Ein Promoter ohne Code gibt keinen Rabatt.
--   * Zugeordnet wird nur im selben Besuch: Der Link trägt ?promo=kürzel,
--     die Adresse reicht es bis zur Kasse weiter. Auf dem Gerät wird dafür
--     nichts gespeichert — deshalb braucht es keinen Einwilligungsdialog.
--     Ein Code des Promoters zählt dagegen die ganze Sitzung, weil er für
--     den Rabatt ohnehin gemerkt wird.
--
-- Die Zuordnung zur Bestellung setzt der Server nach der Reservierung
-- (reserviereBestellung). Sie ist kein Kontingent, um das jemand
-- konkurriert — deshalb bleibt reserviere() unangetastet.
-- ============================================================

begin;

create table if not exists promoter (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Steht im Link: ?promo=max
  kuerzel     text not null,
  -- Der geheime Teil des Statistik-Links. Wer ihn hat, sieht die Zahlen —
  -- deshalb lang und zufällig, und im Backoffice neu erzeugbar.
  token       text not null default
                replace(gen_random_uuid()::text, '-', '') ||
                replace(gen_random_uuid()::text, '-', ''),
  aktiv       boolean not null default true,
  notiz       text,
  erstellt_am timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promoter_kuerzel_form') then
    alter table promoter add constraint promoter_kuerzel_form
      check (kuerzel ~ '^[a-z0-9][a-z0-9-]{1,31}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promoter_name_da') then
    alter table promoter add constraint promoter_name_da check (length(trim(name)) > 0);
  end if;
end $$;

create unique index if not exists promoter_kuerzel_idx on promoter (kuerzel);
create unique index if not exists promoter_token_idx on promoter (token);

alter table rabattcodes
  add column if not exists promoter_id uuid references promoter (id) on delete set null;

alter table bestellungen
  add column if not exists promoter_id uuid references promoter (id) on delete set null;

-- Klicks: Aufrufe einer Eventseite über den Link eines Promoters. Wie der
-- Rest der Auswertung ohne Personenbezug — gezählt wird der Promoter, nicht
-- der Gast.
alter table ereignisse
  add column if not exists promoter_id uuid references promoter (id) on delete set null;

create index if not exists bestellungen_promoter_idx
  on bestellungen (promoter_id) where promoter_id is not null;
create index if not exists ereignisse_promoter_idx
  on ereignisse (promoter_id, art) where promoter_id is not null;
create index if not exists rabattcodes_promoter_idx
  on rabattcodes (promoter_id) where promoter_id is not null;

-- ---------- Zugriffsregeln ----------
-- Wie bei den Rabattcodes: sehen darf das Team, pflegen nur ein Admin. Die
-- Statistikseite der Promoter läuft serverseitig mit dem Dienstschlüssel
-- und liest nur, was zum Token gehört.
alter table promoter enable row level security;

drop policy if exists promoter_lesen on promoter;
create policy promoter_lesen on promoter
  for select using (ist_mitarbeiter('team'));

drop policy if exists promoter_pflegen on promoter;
create policy promoter_pflegen on promoter
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if to_regclass('public.promoter') is null then
    raise exception 'Tabelle promoter fehlt';
  end if;
  if not exists (select 1 from pg_class where relname = 'promoter' and relrowsecurity) then
    raise exception 'promoter ohne Zugriffsregeln';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'bestellungen' and column_name = 'promoter_id')
     or not exists (select 1 from information_schema.columns
                     where table_name = 'rabattcodes' and column_name = 'promoter_id')
     or not exists (select 1 from information_schema.columns
                     where table_name = 'ereignisse' and column_name = 'promoter_id') then
    raise exception 'promoter_id fehlt an bestellungen, rabattcodes oder ereignisse';
  end if;
  if length(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) <> 64 then
    raise exception 'Token hätte nicht 64 Zeichen';
  end if;
end $$;
