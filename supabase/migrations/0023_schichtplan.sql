-- ============================================================
-- Lunar Events — Schichtplan
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Ein Werkzeug im Backoffice: Admins teilen ein, alle anderen sehen
--     nur ihren eigenen Plan.
--   * Je Schicht: Rolle, Person, Beginn und Ende, Station, Pause, Notiz.
--   * Ein- und Auschecken am Abend macht **ein Admin für alle** — niemand
--     steht am Eingang und tippt auf seinem eigenen Handy herum.
--   * Gezählt werden Stunden für die Abrechnung: geplant und tatsächlich.
--
-- Die Rolle steht an der Schicht, nicht nur an der Person: Wer sonst an der
-- Bar steht, kann heute Runner sein. Was jemand in der Software darf, hängt
-- weiter allein an `mitarbeiter.rolle` (Migration 0022) — ein Schichtplan
-- vergibt keine Rechte.
-- ============================================================

begin;

create table if not exists schichten (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events (id) on delete cascade,
  -- Wer arbeitet. Auf auth.users, nicht auf mitarbeiter: Wird jemand aus dem
  -- Team genommen, bleibt seine gearbeitete Schicht für die Abrechnung stehen.
  user_id        uuid not null references auth.users (id) on delete cascade,
  rolle          text not null check (rolle in
                   ('admin', 'kasse', 'einlass', 'bar', 'security', 'runner', 'toiletten')),
  station        text,
  beginn         timestamptz not null,
  ende           timestamptz not null,
  pause_min      int not null default 0 check (pause_min >= 0 and pause_min < 600),
  notiz          text,
  -- Am Abend vom Admin gesetzt.
  eingecheckt_am timestamptz,
  ausgecheckt_am timestamptz,
  plan_gesendet_am timestamptz,
  erstellt_am    timestamptz not null default now(),
  geaendert_am   timestamptz not null default now(),
  constraint schichten_zeitraum check (ende > beginn),
  constraint schichten_pause_passt check (pause_min * 60 < extract(epoch from (ende - beginn))),
  constraint schichten_auschecken check (ausgecheckt_am is null or eingecheckt_am is not null)
);

create index if not exists schichten_event_idx on schichten (event_id, beginn);
create index if not exists schichten_person_idx on schichten (user_id, beginn);
-- Dieselbe Person nicht zweimal zur selben Zeit am selben Event: Doppelte
-- Einträge kommen beim Planen häufiger vor als man denkt.
create unique index if not exists schichten_je_person_idx
  on schichten (event_id, user_id, beginn);

alter table schichten enable row level security;

-- Jeder sieht seine eigenen Schichten — dafür meldet sich das Personal an.
drop policy if exists schichten_eigene on schichten;
create policy schichten_eigene on schichten
  for select using (user_id = auth.uid());

-- Planen, ändern, ein- und auschecken: nur Admins.
drop policy if exists schichten_pflegen on schichten;
create policy schichten_pflegen on schichten
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

-- ---------- Stunden ----------
-- Geplant: Ende minus Beginn minus Pause. Tatsächlich: Auschecken minus
-- Einchecken minus Pause — und nur, wenn beides steht. Gerechnet wird hier,
-- damit Backoffice, eigener Plan und spätere Abrechnung dieselbe Zahl sehen.
create or replace function schicht_stunden(p_schicht schichten)
returns numeric
language sql
immutable
as $$
  select round(greatest(
    extract(epoch from (
      coalesce(p_schicht.ausgecheckt_am, p_schicht.ende)
      - coalesce(p_schicht.eingecheckt_am, p_schicht.beginn)
    )) / 3600.0 - p_schicht.pause_min / 60.0, 0)::numeric, 2);
$$;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_schicht schichten%rowtype;
begin
  if not exists (select 1 from pg_class where relname = 'schichten' and relrowsecurity) then
    raise exception 'schichten ohne Zugriffsregeln';
  end if;

  -- Geplant: 22:00 bis 04:00 mit 30 Minuten Pause = 5,5 Stunden
  v_schicht.beginn := timestamptz '2026-11-14 22:00 Europe/Berlin';
  v_schicht.ende   := timestamptz '2026-11-15 04:00 Europe/Berlin';
  v_schicht.pause_min := 30;
  if schicht_stunden(v_schicht) <> 5.5 then
    raise exception 'Geplante Stunden falsch: %', schicht_stunden(v_schicht);
  end if;

  -- Tatsächlich: eine halbe Stunde später gekommen, pünktlich raus = 5,0
  v_schicht.eingecheckt_am := timestamptz '2026-11-14 22:30 Europe/Berlin';
  v_schicht.ausgecheckt_am := timestamptz '2026-11-15 04:00 Europe/Berlin';
  if schicht_stunden(v_schicht) <> 5.0 then
    raise exception 'Gearbeitete Stunden falsch: %', schicht_stunden(v_schicht);
  end if;

  -- Nie unter null, auch wenn jemand sofort wieder auscheckt
  v_schicht.ausgecheckt_am := v_schicht.eingecheckt_am;
  if schicht_stunden(v_schicht) <> 0 then
    raise exception 'Negative Stunden: %', schicht_stunden(v_schicht);
  end if;

  foreach v_schicht.station in array array['schichten_zeitraum', 'schichten_pause_passt',
                                          'schichten_auschecken', 'schichten_je_person_idx'] loop
    if not exists (select 1 from pg_constraint where conname = v_schicht.station)
       and not exists (select 1 from pg_class where relname = v_schicht.station) then
      raise exception 'Regel % fehlt', v_schicht.station;
    end if;
  end loop;
end $$;
