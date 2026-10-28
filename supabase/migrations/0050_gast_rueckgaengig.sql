-- ============================================================
-- Lunar Events — Gästeliste: Einlass zurücknehmen (28.10.2026)
--
-- Gegenstück zu einlass_rueckgaengig (0049) für die Gästeliste der
-- Crew-App: Ein Fehltipp auf „Einlassen · 3“ muss sich zurücknehmen lassen.
-- Dieselbe Regel: das eigene Einlassen der letzten 30 Minuten darf jede
-- Crew zurücknehmen, alles andere nur Admins. Zurückgenommen werden die
-- zuletzt eingelassenen Tickets des Eintrags, höchstens p_anzahl.
--   ergebnis: zurueck (mit anzahl, drin, personen) | nicht_drin |
--             nicht_erlaubt | unbekannt | keine_berechtigung
-- Der Stand „drin“ folgt über den Trigger aus 0049 von selbst.
-- ============================================================

begin;

create or replace function gast_einlass_rueckgaengig(p_gast_id uuid, p_anzahl int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gast     gaeste%rowtype;
  v_admin    boolean := ist_mitarbeiter('admin');
  v_zurueck  int;
  v_personen int;
  v_drin     int;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_gast from gaeste where id = p_gast_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  if not exists (select 1 from tickets where gast_id = v_gast.id and status = 'entwertet') then
    return jsonb_build_object('ergebnis', 'nicht_drin', 'name', v_gast.name);
  end if;

  with weg as (
    select id from tickets
     where gast_id = v_gast.id and status = 'entwertet'
       and (v_admin or (entwertet_von = auth.uid() and entwertet_am >= now() - interval '30 minutes'))
     order by entwertet_am desc, id
     limit greatest(coalesce(p_anzahl, 1), 0)
     for update
  )
  update tickets t
     set status = 'gueltig', entwertet_am = null, entwertet_von = null
    from weg
   where t.id = weg.id;
  get diagnostics v_zurueck = row_count;

  select count(*) filter (where status <> 'storniert'),
         count(*) filter (where status = 'entwertet')
    into v_personen, v_drin
    from tickets where gast_id = v_gast.id;

  if v_zurueck = 0 then
    return jsonb_build_object('ergebnis', 'nicht_erlaubt', 'name', v_gast.name,
      'drin', v_drin, 'personen', v_personen);
  end if;

  return jsonb_build_object('ergebnis', 'zurueck', 'name', v_gast.name,
    'anzahl', v_zurueck, 'drin', v_drin, 'personen', v_personen);
end;
$$;

revoke all on function gast_einlass_rueckgaengig(uuid, int) from public, anon;
grant execute on function gast_einlass_rueckgaengig(uuid, int) to authenticated, service_role;

-- ---------- Selbstprüfung ----------
do $$
begin
  if has_function_privilege('anon', 'gast_einlass_rueckgaengig(uuid, int)', 'execute') then
    raise exception 'gast_einlass_rueckgaengig für anon aufrufbar';
  end if;
  if not has_function_privilege('authenticated', 'gast_einlass_rueckgaengig(uuid, int)', 'execute') then
    raise exception 'Personal kann gast_einlass_rueckgaengig nicht aufrufen';
  end if;
  if gast_einlass_rueckgaengig(gen_random_uuid(), 1) ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'gast_einlass_rueckgaengig ohne Anmeldung antwortet falsch';
  end if;
end $$;

commit;
