-- ============================================================
-- Lunar Events — Grundgeruest
--
-- Idempotent: laesst sich mehrfach einspielen. Am Ende steht eine
-- Selbstpruefung, die bei Unstimmigkeit alles zurueckrollt.
-- ============================================================

begin;

-- E-Mail-Adressen vergleichen sich ohne Ruecksicht auf Gross- und
-- Kleinschreibung; sonst waeren Max@… und max@… zwei Kunden.
create extension if not exists "citext";

-- Kein pgcrypto: Supabase legt Erweiterungen im Schema "extensions" ab,
-- das beim Migrationslauf nicht im Suchpfad steht — gen_random_bytes()
-- waere dort nicht auffindbar. gen_random_uuid() steht seit Postgres 13
-- im Systemkatalog und ist damit immer da.

-- ---------- Aufzaehlungen ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'kategorie') then
    create type kategorie as enum ('club', 'party', 'festival', 'rooftop', 'special');
  end if;
  if not exists (select 1 from pg_type where typname = 'event_status') then
    create type event_status as enum ('entwurf', 'veroeffentlicht', 'abgesagt', 'archiviert');
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_art') then
    create type ticket_art as enum ('standard', 'vip');
  end if;
  if not exists (select 1 from pg_type where typname = 'bestell_status') then
    create type bestell_status as enum ('offen', 'bezahlt', 'storniert', 'erstattet', 'abgelaufen');
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type ticket_status as enum ('gueltig', 'entwertet', 'storniert');
  end if;
  if not exists (select 1 from pg_type where typname = 'zahlungsart') then
    create type zahlungsart as enum ('stripe', 'paypal', 'abendkasse', 'frei');
  end if;
  if not exists (select 1 from pg_type where typname = 'anfrage_status') then
    create type anfrage_status as enum ('neu', 'in_bearbeitung', 'angebot', 'bestaetigt', 'abgelehnt');
  end if;
end $$;

-- ---------- Rollen ----------
-- Wer im Backoffice arbeitet oder am Einlass scannt, steht hier. Alles
-- andere ist Kundschaft. Eine eigene Tabelle statt eines Flags in auth,
-- damit die Zugriffsregeln sie mitlesen koennen.
create table if not exists mitarbeiter (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  rolle       text not null default 'einlass'
                check (rolle in ('admin', 'team', 'einlass')),
  aktiv       boolean not null default true,
  erstellt_am timestamptz not null default now()
);

create or replace function ist_mitarbeiter(mindestens text default 'einlass')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from mitarbeiter m
    where m.user_id = auth.uid()
      and m.aktiv
      and case mindestens
            when 'admin'   then m.rolle = 'admin'
            when 'team'    then m.rolle in ('admin', 'team')
            else true
          end
  );
$$;

-- ---------- Orte ----------
create table if not exists orte (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  stadt    text not null,
  strasse  text,
  plz      text,
  land     text not null default 'DE',
  lat      double precision,
  lng      double precision,
  erstellt_am timestamptz not null default now()
);

-- ---------- Events ----------
create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  titel         text not null,
  untertitel    text,
  teaser        text,
  beschreibung  text,
  kategorie     kategorie not null default 'club',
  status        event_status not null default 'entwurf',
  beginn        timestamptz not null,
  einlass       timestamptz,
  ende          timestamptz,
  ort_id        uuid not null references orte (id) on delete restrict,
  bild_pfad     text,
  bild_alt      text,
  bild_fokus    text,
  mindestalter  int check (mindestalter between 0 and 99),
  dresscode     text,
  veranstalter  text not null default 'Lunar Events',
  -- Abendkasse ist eine Zusage an den Gast, deshalb ausdruecklich gesetzt
  -- und nicht aus Restkontingenten erschlossen.
  abendkasse    boolean not null default false,
  abendkasse_hinweis text,
  featured      boolean not null default false,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz not null default now()
);

create index if not exists events_beginn_idx on events (beginn);
create index if not exists events_status_idx on events (status, beginn);

-- ---------- Ticketphasen ----------
create table if not exists phasen (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events (id) on delete cascade,
  name          text not null,
  art           ticket_art not null default 'standard',
  preis_cent    int not null default 0 check (preis_cent >= 0),
  gebuehr_cent  int not null default 0 check (gebuehr_cent >= 0),
  -- null = unbegrenzt (durch die Saalgroesse gedeckelt, nicht durch uns)
  kontingent    int check (kontingent >= 0),
  verkauft      int not null default 0 check (verkauft >= 0),
  ab            timestamptz,
  bis           timestamptz,
  leistungen    text[] not null default '{}',
  beschreibung  text,
  position      int not null default 0,
  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now(),
  -- Mehr verkaufen als vorhanden ist geht nicht. Das steht hier und nicht
  -- nur im Anwendungscode, weil die Datenbank der letzte Ort ist, an dem
  -- es noch jemand merkt.
  constraint phasen_nicht_ueberverkauft
    check (kontingent is null or verkauft <= kontingent)
);

create index if not exists phasen_event_idx on phasen (event_id, position);

-- ---------- Kunden ----------
-- Gastkaeufe sind ausdruecklich moeglich: user_id bleibt dann null. Wer
-- sich spaeter anmeldet, bekommt seine Bestellungen ueber die E-Mail
-- zugeordnet.
create table if not exists kunden (
  id          uuid primary key default gen_random_uuid(),
  email       citext,
  vorname     text,
  nachname    text,
  telefon     text,
  user_id     uuid references auth.users (id) on delete set null,
  erstellt_am timestamptz not null default now()
);

create unique index if not exists kunden_email_idx on kunden (email);
create index if not exists kunden_user_idx on kunden (user_id);

-- ---------- Bestellungen ----------
create sequence if not exists bestellnummer_seq start 1000;

create table if not exists bestellungen (
  id             uuid primary key default gen_random_uuid(),
  nummer         text not null unique,
  event_id       uuid not null references events (id) on delete restrict,
  kunde_id       uuid not null references kunden (id) on delete restrict,
  status         bestell_status not null default 'offen',
  summe_cent     int not null default 0 check (summe_cent >= 0),
  gebuehr_cent   int not null default 0 check (gebuehr_cent >= 0),
  gesamt_cent    int not null default 0 check (gesamt_cent >= 0),
  zahlungsart    zahlungsart,
  zahlung_ref    text,
  -- Solange nicht bezahlt ist, haelt die Bestellung das Kontingent nur
  -- befristet. Laeuft die Frist ab, gibt ein Aufraeumlauf sie zurueck.
  reserviert_bis timestamptz,
  erstellt_am    timestamptz not null default now(),
  bezahlt_am     timestamptz
);

create index if not exists bestellungen_kunde_idx on bestellungen (kunde_id);
create index if not exists bestellungen_event_idx on bestellungen (event_id, status);
create index if not exists bestellungen_offen_idx on bestellungen (reserviert_bis)
  where status = 'offen';

create table if not exists bestellpositionen (
  id               uuid primary key default gen_random_uuid(),
  bestellung_id    uuid not null references bestellungen (id) on delete cascade,
  phase_id         uuid not null references phasen (id) on delete restrict,
  -- Name und Preis werden kopiert, nicht verknuepft: eine Bestellung muss
  -- auch dann noch stimmen, wenn die Phase spaeter umbenannt wird.
  phase_name       text not null,
  menge            int not null check (menge > 0),
  einzelpreis_cent int not null check (einzelpreis_cent >= 0),
  gebuehr_cent     int not null default 0 check (gebuehr_cent >= 0)
);

create index if not exists bestellpositionen_bestellung_idx
  on bestellpositionen (bestellung_id);

-- ---------- Tickets ----------
create table if not exists tickets (
  id            uuid primary key default gen_random_uuid(),
  bestellung_id uuid not null references bestellungen (id) on delete cascade,
  event_id      uuid not null references events (id) on delete restrict,
  phase_id      uuid not null references phasen (id) on delete restrict,
  phase_name    text not null,
  art           ticket_art not null default 'standard',
  -- Der Wert im QR-Code. Zufaellig und nicht aus der ID ableitbar, sonst
  -- koennte man sich aus einem Ticket die anderen errechnen.
  code          text not null unique,
  status        ticket_status not null default 'gueltig',
  gast_name     text,
  platz         text,
  entwertet_am  timestamptz,
  entwertet_von uuid references auth.users (id) on delete set null,
  erstellt_am   timestamptz not null default now()
);

create index if not exists tickets_bestellung_idx on tickets (bestellung_id);
create index if not exists tickets_event_idx on tickets (event_id, status);

-- ---------- VIP-Anfragen ----------
create table if not exists vip_anfragen (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references events (id) on delete set null,
  name         text not null,
  email        citext not null,
  telefon      text,
  gaeste       int not null default 2 check (gaeste > 0),
  wunschdatum  date,
  paket        text,
  nachricht    text,
  status       anfrage_status not null default 'neu',
  notiz_intern text,
  erstellt_am  timestamptz not null default now()
);

create index if not exists vip_anfragen_status_idx on vip_anfragen (status, erstellt_am desc);

-- ---------- Newsletter ----------
create table if not exists newsletter (
  email       citext primary key,
  bestaetigt  boolean not null default false,
  token       text not null default replace(gen_random_uuid()::text, '-', ''),
  erstellt_am timestamptz not null default now()
);

commit;

-- ============================================================
-- Selbstpruefung: fehlt etwas, faellt die Migration auf.
-- ============================================================
do $$
declare
  fehlt text;
begin
  select string_agg(t, ', ')
    into fehlt
    from unnest(array[
      'mitarbeiter','orte','events','phasen','kunden','bestellungen',
      'bestellpositionen','tickets','vip_anfragen','newsletter'
    ]) as t
   where to_regclass('public.' || t) is null;

  if fehlt is not null then
    raise exception 'Migration unvollstaendig, es fehlen: %', fehlt;
  end if;
end $$;
