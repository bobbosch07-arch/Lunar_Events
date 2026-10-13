-- ============================================================
-- Lunar Events — Kontingente einzeln verwalten (13.10.2026)
--
-- Bisher änderte man ein Kontingent nur über das große Event-Formular, das
-- alle Phasen mit dem Stand beim Öffnen zurückschrieb. Jetzt gibt es eigene
-- Schritte, jeder für sich, jeder unter Sperre der betroffenen Phasen, damit
-- ein gleichzeitiger Kauf nicht dazwischenrechnet:
--
--   phase_kontingent_setzen   ein Kontingent ändern, nie unter „verkauft“
--   phase_tickets_verschieben freie Tickets von einer Phase in eine andere
--   phase_schliessen          Phase zu, freie Tickets verteilen, Rest weg
--   phase_oeffnen             eine geschlossene Phase wieder öffnen
--   phasen_belegung           je Phase bezahlt und reserviert, für die Leisten
--
-- „verkauft“ zählt Reservierungen mit (reserviere() zählt hoch, der
-- Aufräumlauf gibt verfallene zurück). Eine geschlossene Phase ist inaktiv:
-- Läuft dort später eine Reservierung ab, wird sie nicht wieder kaufbar;
-- die Übersicht zeigt den frei gewordenen Platz zum Verteilen an.
-- ============================================================

begin;

-- ---------- Belegung je Phase ----------
create or replace function phasen_belegung(p_event_id uuid)
returns table (phase_id uuid, bezahlt int, reserviert int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ist_mitarbeiter('team') then
    raise exception 'NUR_TEAM';
  end if;
  return query
    select bp.phase_id,
           coalesce(sum(bp.menge) filter (where b.status = 'bezahlt'), 0)::int,
           coalesce(sum(bp.menge) filter (where b.status = 'offen'), 0)::int
      from bestellpositionen bp
      join bestellungen b on b.id = bp.bestellung_id
     where b.event_id = p_event_id
     group by bp.phase_id;
end;
$$;

-- ---------- Kontingent setzen ----------
create or replace function phase_kontingent_setzen(p_phase uuid, p_kontingent int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v phasen%rowtype;
begin
  if not ist_mitarbeiter('admin') then
    raise exception 'NUR_ADMIN';
  end if;
  if p_kontingent is null or p_kontingent < 0 or p_kontingent > 100000 then
    raise exception 'UNGUELTIG';
  end if;
  select * into v from phasen where id = p_phase for update;
  if not found then
    raise exception 'UNBEKANNT';
  end if;
  if p_kontingent < v.verkauft then
    raise exception 'UNTER_VERKAUFT:%', v.verkauft;
  end if;
  update phasen set kontingent = p_kontingent where id = p_phase;
  return jsonb_build_object('event_id', v.event_id, 'kontingent', p_kontingent);
end;
$$;

-- ---------- Tickets verschieben ----------
create or replace function phase_tickets_verschieben(p_von uuid, p_nach uuid, p_menge int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_von  phasen%rowtype;
  v_nach phasen%rowtype;
begin
  if not ist_mitarbeiter('admin') then
    raise exception 'NUR_ADMIN';
  end if;
  if p_von = p_nach then
    raise exception 'GLEICHE_PHASE';
  end if;
  if p_menge is null or p_menge < 1 then
    raise exception 'UNGUELTIG';
  end if;

  -- Immer in derselben Reihenfolge sperren, sonst können sich zwei
  -- gleichzeitige Verschiebungen gegenseitig festhalten.
  perform 1 from phasen where id in (p_von, p_nach) order by id for update;
  select * into v_von from phasen where id = p_von;
  select * into v_nach from phasen where id = p_nach;

  if v_von.id is null or v_nach.id is null then
    raise exception 'UNBEKANNT';
  end if;
  if v_von.event_id <> v_nach.event_id then
    raise exception 'ANDERES_EVENT';
  end if;
  if v_von.kontingent is null or v_nach.kontingent is null then
    raise exception 'UNBEGRENZT';
  end if;
  if p_menge > v_von.kontingent - v_von.verkauft then
    raise exception 'ZU_VIEL:%', v_von.kontingent - v_von.verkauft;
  end if;

  update phasen set kontingent = kontingent - p_menge where id = p_von;
  update phasen set kontingent = kontingent + p_menge where id = p_nach;
  return jsonb_build_object('event_id', v_von.event_id, 'menge', p_menge);
end;
$$;

-- ---------- Phase schließen ----------
-- p_verteilung: [{"phase_id": "...", "menge": 6}, ...]. Was nicht verteilt
-- wird, fällt weg: Das Kontingent der Phase sinkt auf das Verkaufte.
create or replace function phase_schliessen(p_phase uuid, p_verteilung jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        phasen%rowtype;
  v_ziel   phasen%rowtype;
  v_frei   int;
  v_summe  int := 0;
  v_teil   jsonb;
  v_menge  int;
begin
  if not ist_mitarbeiter('admin') then
    raise exception 'NUR_ADMIN';
  end if;

  select * into v from phasen where id = p_phase;
  if not found then
    raise exception 'UNBEKANNT';
  end if;
  -- Alle Phasen des Events sperren: Ziele und Quelle in einem Zug.
  perform 1 from phasen where event_id = v.event_id order by id for update;
  select * into v from phasen where id = p_phase;

  v_frei := case when v.kontingent is null then 0 else v.kontingent - v.verkauft end;

  for v_teil in select * from jsonb_array_elements(coalesce(p_verteilung, '[]'::jsonb)) loop
    v_menge := coalesce((v_teil ->> 'menge')::int, 0);
    continue when v_menge = 0;
    if v_menge < 0 then
      raise exception 'UNGUELTIG';
    end if;
    select * into v_ziel from phasen where id = (v_teil ->> 'phase_id')::uuid;
    if v_ziel.id is null or v_ziel.event_id <> v.event_id or v_ziel.id = v.id then
      raise exception 'ZIEL_UNGUELTIG';
    end if;
    if v_ziel.kontingent is null then
      raise exception 'UNBEGRENZT';
    end if;
    v_summe := v_summe + v_menge;
    update phasen set kontingent = kontingent + v_menge where id = v_ziel.id;
  end loop;

  if v_summe > v_frei then
    raise exception 'ZU_VIEL:%', v_frei;
  end if;

  update phasen
     set aktiv = false,
         kontingent = case when kontingent is null then null else verkauft end
   where id = p_phase;

  return jsonb_build_object('event_id', v.event_id, 'frei', v_frei, 'verteilt', v_summe);
end;
$$;

-- ---------- Phase wieder öffnen ----------
create or replace function phase_oeffnen(p_phase uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
begin
  if not ist_mitarbeiter('admin') then
    raise exception 'NUR_ADMIN';
  end if;
  update phasen set aktiv = true where id = p_phase returning event_id into v_event;
  if v_event is null then
    raise exception 'UNBEKANNT';
  end if;
  return jsonb_build_object('event_id', v_event);
end;
$$;

revoke execute on function phasen_belegung(uuid) from public, anon;
revoke execute on function phase_kontingent_setzen(uuid, int) from public, anon;
revoke execute on function phase_tickets_verschieben(uuid, uuid, int) from public, anon;
revoke execute on function phase_schliessen(uuid, jsonb) from public, anon;
revoke execute on function phase_oeffnen(uuid) from public, anon;
grant execute on function phasen_belegung(uuid) to authenticated, service_role;
grant execute on function phase_kontingent_setzen(uuid, int) to authenticated, service_role;
grant execute on function phase_tickets_verschieben(uuid, uuid, int) to authenticated, service_role;
grant execute on function phase_schliessen(uuid, jsonb) to authenticated, service_role;
grant execute on function phase_oeffnen(uuid) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if has_function_privilege('anon', 'public.phase_schliessen(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.phase_tickets_verschieben(uuid, uuid, int)', 'execute')
     or has_function_privilege('anon', 'public.phase_kontingent_setzen(uuid, int)', 'execute')
     or has_function_privilege('anon', 'public.phasen_belegung(uuid)', 'execute') then
    raise exception 'Kontingent-Funktionen sind für anon aufrufbar';
  end if;
  -- Ohne Anmeldung (hier als Migration ohne auth.uid) weist jede ab.
  begin
    perform phase_oeffnen(gen_random_uuid());
    raise exception 'phase_oeffnen ohne Admin durchgelassen';
  exception when raise_exception then
    if sqlerrm <> 'NUR_ADMIN' then raise; end if;
  end;
end $$;
