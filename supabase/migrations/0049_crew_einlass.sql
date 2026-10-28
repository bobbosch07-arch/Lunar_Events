-- ============================================================
-- Lunar Events — Crew-App: Einlass mit Entscheidung, Live-Belegung (28.10.2026)
--
-- 1. Ein Scan entwertet bei Lunar nicht mehr von selbst. Die Crew prüft den
--    Ausweis (Name und ab 18, kein Geburtsdatum gespeichert) und entscheidet:
--    einlass_pruefen   Urteil wie beim Scan, ändert nichts
--    einlass_reinlassen entwertet (dasselbe wie der bisherige Scan)
--    einlass_rueckgaengig nimmt eine Entwertung zurück
--    Abweisen braucht keinen Aufruf: Das Ticket bleibt einfach gültig.
--    Der Modus steht je Event (events.einlass_modus), Lunar: 'entscheiden'.
-- 2. "Drin" ist die Zahl der entwerteten Tickets eines Events. Scanner,
--    Gästeliste und Abendkasse entwerten alle, also zählt jeder Weg von
--    selbst mit — kein eigener Zähler, der auseinanderlaufen könnte.
--    Für Supabase Realtime hält ein Trigger eine Zeile je Event in
--    einlass_stand aktuell. Er rechnet mit Deltas (+1/−1) unter Zeilensperre,
--    nicht mit count(*): Zwei gleichzeitige Scans sähen beim Zählen die
--    jeweils andere, noch offene Entwertung nicht.
-- 3. events.kapazitaet für die Ampel an der Kasse (null = ohne Grenze).
-- 4. einlass_nachtragen_aktionen: Offline gesammelte Entscheidungen in
--    Reihenfolge, Reinlassen und Rückgängig gemischt.
--
-- entwerte_ticket bleibt unverändert für den alten Scanner /einlass, der bis
-- nach dem Opening als Rückfallweg dient.
-- ============================================================

begin;

-- ---------- Spalten ----------
alter table events add column if not exists kapazitaet int check (kapazitaet > 0);
alter table events add column if not exists einlass_modus text not null default 'entscheiden';
alter table events drop constraint if exists events_einlass_modus_check;
alter table events add constraint events_einlass_modus_check
  check (einlass_modus in ('automatisch', 'entscheiden'));

-- ---------- Stand je Event ----------
create table if not exists einlass_stand (
  event_id     uuid primary key references events (id) on delete cascade,
  drin         int not null default 0,
  geaendert_am timestamptz not null default now()
);

alter table einlass_stand enable row level security;
drop policy if exists einlass_stand_lesen on einlass_stand;
create policy einlass_stand_lesen on einlass_stand
  for select using (ist_mitarbeiter('einlass'));
revoke all on table einlass_stand from anon;
revoke insert, update, delete on table einlass_stand from authenticated;
grant select on table einlass_stand to authenticated;

create or replace function einlass_stand_nachfuehren()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alt int := 0;
  v_neu int := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'entwertet' then v_alt := 1; end if;
  if tg_op in ('UPDATE', 'INSERT') and new.status = 'entwertet' then v_neu := 1; end if;

  if tg_op = 'UPDATE' and old.event_id <> new.event_id then
    -- Kommt nicht vor, wäre aber sonst still falsch.
    insert into einlass_stand (event_id, drin) values (old.event_id, -v_alt)
      on conflict (event_id) do update
      set drin = einlass_stand.drin - v_alt, geaendert_am = now();
    insert into einlass_stand (event_id, drin) values (new.event_id, v_neu)
      on conflict (event_id) do update
      set drin = einlass_stand.drin + v_neu, geaendert_am = now();
    return null;
  end if;

  if v_neu - v_alt <> 0 then
    insert into einlass_stand (event_id, drin)
    values (coalesce(new.event_id, old.event_id), v_neu - v_alt)
    on conflict (event_id) do update
      set drin = einlass_stand.drin + (v_neu - v_alt), geaendert_am = now();
  end if;
  return null;
end;
$$;

drop trigger if exists tickets_einlass_stand on tickets;
create trigger tickets_einlass_stand
  after insert or update of status, event_id or delete on tickets
  for each row execute function einlass_stand_nachfuehren();

-- Anfangsstand aus den Tickets (idempotent: setzt, statt zu addieren).
insert into einlass_stand (event_id, drin)
select e.id, (select count(*) from tickets t where t.event_id = e.id and t.status = 'entwertet')
  from events e
on conflict (event_id) do update set drin = excluded.drin, geaendert_am = now();

-- Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'einlass_stand') then
    alter publication supabase_realtime add table einlass_stand;
  end if;
end $$;

-- ---------- Urteil (intern) ----------
-- Dieselbe Logik wie entwerte_ticket, ohne Rechteprüfung — die machen die
-- öffentlichen Funktionen darüber. Nicht für Clients freigegeben.
create or replace function einlass_urteil(p_code text, p_event_id uuid, p_entwerten boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket     tickets%rowtype;
  v_event      events%rowtype;
  v_name_fehlt boolean;
  v_basis      jsonb;
begin
  select * into v_ticket from tickets where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  select * into v_event from events where id = v_ticket.event_id;

  if p_event_id is not null and v_ticket.event_id <> p_event_id then
    return jsonb_build_object('ergebnis', 'anderes_event',
      'event', v_event.titel, 'beginn', v_event.beginn, 'typ', v_ticket.phase_name);
  end if;

  v_name_fehlt := v_ticket.gast_name is null
    and v_ticket.bestellung_id is not null
    and not coalesce((select abendkasse from bestellungen where id = v_ticket.bestellung_id), false);

  v_basis := jsonb_build_object(
    'event', v_event.titel,
    'typ', v_ticket.phase_name,
    'art', v_ticket.art,
    'fastlane', v_ticket.fastlane,
    'gast', v_ticket.gast_name,
    'name_fehlt', v_name_fehlt,
    'platz', v_ticket.platz);

  if v_ticket.status = 'storniert' then
    return v_basis || jsonb_build_object('ergebnis', 'storniert');
  end if;

  if v_ticket.status = 'entwertet' then
    return v_basis || jsonb_build_object('ergebnis', 'schon_entwertet',
      'zeitpunkt', v_ticket.entwertet_am,
      'eigenes', v_ticket.entwertet_von = auth.uid());
  end if;

  if p_entwerten then
    update tickets
       set status = 'entwertet', entwertet_am = now(), entwertet_von = auth.uid()
     where id = v_ticket.id;
    return v_basis || jsonb_build_object('ergebnis', 'drin');
  end if;

  return v_basis || jsonb_build_object('ergebnis', 'gueltig');
end;
$$;

revoke all on function einlass_urteil(text, uuid, boolean) from public, anon, authenticated;

create or replace function einlass_drin(p_event_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select drin from einlass_stand where event_id = p_event_id), 0);
$$;

revoke all on function einlass_drin(uuid) from public, anon, authenticated;

-- ---------- Öffentlich: prüfen, reinlassen, rückgängig ----------
create or replace function einlass_pruefen(p_code text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  return einlass_urteil(p_code, p_event_id, false)
      || jsonb_build_object('drin', einlass_drin(p_event_id));
end;
$$;

create or replace function einlass_reinlassen(p_code text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_erg jsonb;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if p_event_id is null then
    return jsonb_build_object('ergebnis', 'kein_event');
  end if;
  v_erg := einlass_urteil(p_code, p_event_id, true);
  return v_erg || jsonb_build_object('drin', einlass_drin(p_event_id));
end;
$$;

-- Nimmt eine Entwertung zurück. Das eigene Reinlassen der letzten 30 Minuten
-- darf jede Crew zurücknehmen, alles andere nur Admins — sonst ließe sich
-- ein Ticket nach dem Einlass für die nächste Person wieder gültig machen.
create or replace function einlass_rueckgaengig(p_code text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_ticket from tickets
   where code = upper(btrim(coalesce(p_code, ''))) and event_id = p_event_id
   for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_ticket.status <> 'entwertet' then
    return jsonb_build_object('ergebnis', 'nicht_drin', 'status', v_ticket.status,
      'drin', einlass_drin(p_event_id));
  end if;
  if not ist_mitarbeiter('admin')
     and (v_ticket.entwertet_von is distinct from auth.uid()
          or v_ticket.entwertet_am < now() - interval '30 minutes') then
    return jsonb_build_object('ergebnis', 'nicht_erlaubt', 'drin', einlass_drin(p_event_id));
  end if;

  update tickets
     set status = 'gueltig', entwertet_am = null, entwertet_von = null
   where id = v_ticket.id;

  return jsonb_build_object('ergebnis', 'zurueck', 'gast', v_ticket.gast_name,
    'typ', v_ticket.phase_name, 'drin', einlass_drin(p_event_id));
end;
$$;

-- ---------- Stand für den ersten Abruf ----------
create or replace function einlass_stand_abrufen(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('einlass') then
           jsonb_build_object('ergebnis', 'keine_berechtigung')
         else (select jsonb_build_object('ergebnis', 'ok',
                 'drin', einlass_drin(e.id),
                 'kapazitaet', e.kapazitaet,
                 'modus', e.einlass_modus)
                 from events e where e.id = p_event_id)
         end;
$$;

-- ---------- Offline gesammelte Entscheidungen nachtragen ----------
-- p_aktionen: [{"code": "...", "aktion": "rein" | "zurueck"}, ...] in der
-- Reihenfolge, in der sie am Gerät passiert sind. Antwortet je Aktion mit
-- dem Ergebnis; "schon_entwertet" mit eigenes = false heißt: Ein anderes
-- Gerät hat dieses Ticket vorher eingelassen, es kam also zweimal rein.
-- Höchstens 500 je Aufruf.
create or replace function einlass_nachtragen_aktionen(p_aktionen jsonb, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktion jsonb;
  v_erg    jsonb;
  v_liste  jsonb := '[]'::jsonb;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if jsonb_typeof(p_aktionen) <> 'array' or jsonb_array_length(p_aktionen) > 500 then
    raise exception 'ZU_VIELE';
  end if;
  for v_aktion in select * from jsonb_array_elements(p_aktionen) loop
    if v_aktion->>'aktion' = 'zurueck' then
      v_erg := einlass_rueckgaengig(v_aktion->>'code', p_event_id);
    else
      v_erg := einlass_urteil(v_aktion->>'code', p_event_id, true);
    end if;
    v_liste := v_liste || jsonb_build_array(jsonb_build_object(
      'code', v_aktion->>'code',
      'aktion', coalesce(v_aktion->>'aktion', 'rein'),
      'ergebnis', v_erg->>'ergebnis',
      'gast', v_erg->>'gast',
      'eigenes', coalesce((v_erg->>'eigenes')::boolean, false)));
  end loop;
  return jsonb_build_object('ergebnis', 'ok', 'liste', v_liste, 'drin', einlass_drin(p_event_id));
end;
$$;

-- ---------- Rechte ----------
revoke all on function einlass_pruefen(text, uuid) from public, anon;
revoke all on function einlass_reinlassen(text, uuid) from public, anon;
revoke all on function einlass_rueckgaengig(text, uuid) from public, anon;
revoke all on function einlass_stand_abrufen(uuid) from public, anon;
revoke all on function einlass_nachtragen_aktionen(jsonb, uuid) from public, anon;
grant execute on function einlass_pruefen(text, uuid) to authenticated, service_role;
grant execute on function einlass_reinlassen(text, uuid) to authenticated, service_role;
grant execute on function einlass_rueckgaengig(text, uuid) to authenticated, service_role;
grant execute on function einlass_stand_abrufen(uuid) to authenticated, service_role;
grant execute on function einlass_nachtragen_aktionen(jsonb, uuid) to authenticated, service_role;
revoke all on function einlass_stand_nachfuehren() from public, anon, authenticated;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_falsch int;
begin
  select count(*) into v_falsch
    from events e
    left join einlass_stand s on s.event_id = e.id
   where coalesce(s.drin, 0) <> (select count(*) from tickets t
                                  where t.event_id = e.id and t.status = 'entwertet');
  if v_falsch > 0 then
    raise exception 'einlass_stand weicht bei % Events von den Tickets ab', v_falsch;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tickets_einlass_stand') then
    raise exception 'Trigger tickets_einlass_stand fehlt';
  end if;
  if has_function_privilege('authenticated', 'einlass_urteil(text, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'einlass_reinlassen(text, uuid)', 'execute')
     or has_function_privilege('anon', 'einlass_pruefen(text, uuid)', 'execute')
     or has_function_privilege('anon', 'einlass_rueckgaengig(text, uuid)', 'execute')
     or has_function_privilege('anon', 'einlass_nachtragen_aktionen(jsonb, uuid)', 'execute') then
    raise exception 'Einlass-Funktionen zu weit freigegeben';
  end if;
  if not has_function_privilege('authenticated', 'einlass_reinlassen(text, uuid)', 'execute') then
    raise exception 'Personal kann einlass_reinlassen nicht aufrufen';
  end if;
  if einlass_pruefen('XYZ', null) ->> 'ergebnis' <> 'keine_berechtigung'
     or einlass_reinlassen('XYZ', null) ->> 'ergebnis' <> 'keine_berechtigung'
     or einlass_rueckgaengig('XYZ', null) ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'Einlass-Funktionen ohne Anmeldung antworten falsch';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'einlass_stand') then
    raise exception 'einlass_stand fehlt in Realtime';
  end if;
end $$;

commit;
