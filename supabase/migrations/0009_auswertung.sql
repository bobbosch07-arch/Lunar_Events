-- ============================================================
-- Lunar Events — Auswertung ohne Personenbezug
--
-- Das Briefing verlangt Zahlen: Eventaufrufe, begonnene und
-- abgeschlossene Kaufvorgänge, Abbrüche, Konversion, Herkunft.
--
-- Bewusst ohne alles, was eine Person wiedererkennbar macht: keine
-- IP-Adresse, keine Kennung, kein Cookie, keine Sitzung. Damit ist das
-- hier keine Einwilligungsfrage, sondern eine Zählung — und die Zahlen
-- bleiben trotzdem brauchbar, weil es um Verhältnisse geht und nicht um
-- einzelne Leute.
--
-- Was dadurch nicht geht: Wiederkehrende Besucher erkennen, einzelne
-- Wege nachverfolgen, "Unique Visitors". Wer das später braucht, kommt
-- um einen Einwilligungsdialog nicht herum.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ereignis_art') then
    create type ereignis_art as enum (
      'seite',            -- irgendeine Seite aufgerufen
      'event_gesehen',    -- ein Eventdetail geöffnet
      'ticket_gewaehlt',  -- erstmals eine Menge gewählt
      'kasse_begonnen',   -- Kasse geöffnet
      'daten_erfasst',    -- Reservierung angelegt
      'kauf_abgeschlossen',
      'vip_angefragt'
    );
  end if;
end $$;

create table if not exists ereignisse (
  id          bigserial primary key,
  art         ereignis_art not null,
  event_id    uuid references events (id) on delete set null,
  -- Woher der Besuch kam, grob: "instagram", "direkt", "google".
  -- Nur die Quelle, nie die vollständige Herkunftsadresse.
  quelle      text,
  -- Kampagnenkennung aus der Adresse (utm_campaign), falls vorhanden.
  kampagne    text,
  -- Handy oder Rechner. Mehr wird über das Gerät nicht festgehalten.
  geraet      text check (geraet in ('mobil', 'rechner')),
  -- Auf die Stunde gerundet: Für Auswertungen genügt das, und eine
  -- sekundengenaue Spur wäre bei wenig Verkehr fast schon ein Merkmal.
  stunde      timestamptz not null default date_trunc('hour', now()),
  erstellt_am timestamptz not null default now()
);

create index if not exists ereignisse_art_idx on ereignisse (art, stunde desc);
create index if not exists ereignisse_event_idx on ereignisse (event_id, art);

alter table ereignisse enable row level security;

-- Jeder darf zählen, niemand außer dem Team darf lesen.
drop policy if exists ereignisse_zaehlen on ereignisse;
create policy ereignisse_zaehlen on ereignisse for insert with check (true);

drop policy if exists ereignisse_lesen on ereignisse;
create policy ereignisse_lesen on ereignisse
  for select using (ist_mitarbeiter('team'));

/**
 * Zahlen je Event. Als Funktion, damit die Auswertung nicht davon
 * abhängt, wie jemand im Backoffice gerade eine Abfrage baut.
 */
create or replace function auswertung_je_event(p_tage int default 90)
returns table (
  event_id uuid,
  titel text,
  gesehen bigint,
  gewaehlt bigint,
  kasse bigint,
  gekauft bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.titel,
         count(*) filter (where z.art = 'event_gesehen')      as gesehen,
         count(*) filter (where z.art = 'ticket_gewaehlt')    as gewaehlt,
         count(*) filter (where z.art = 'kasse_begonnen')     as kasse,
         count(*) filter (where z.art = 'kauf_abgeschlossen') as gekauft
    from events e
    left join ereignisse z
      on z.event_id = e.id
     and z.stunde > now() - make_interval(days => p_tage)
   group by e.id, e.titel
   order by gesehen desc;
$$;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if to_regclass('public.ereignisse') is null then
    raise exception 'Tabelle ereignisse fehlt';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'auswertung_je_event'
  ) then
    raise exception 'Funktion auswertung_je_event fehlt';
  end if;
end $$;
