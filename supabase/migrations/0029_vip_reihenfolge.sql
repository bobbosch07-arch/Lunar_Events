-- ============================================================
-- Lunar Events — VIP-Gäste in der Reihenfolge, in der sie eingetragen wurden
--
-- speichere_vip() (0028) legt alle Gäste einer Buchung in einer Transaktion
-- an. erstellt_am stand dabei auf now() — das ist die Zeit der Transaktion,
-- also für alle dieselbe. Backoffice, Ticketseite und Mail sortieren nach
-- erstellt_am, bei Gleichstand nach der zufälligen ID: Die Namen standen
-- durcheinander statt so, wie der Admin sie eingetragen hat (der erste ist
-- die Person, die angefragt hat). Aufgefallen im Prüfskript, das mal grün,
-- mal rot war.
--
-- Bestehende Buchungen bleiben, wie sie sind — beim ersten Echtbetrieb gab
-- es noch keine.
-- ============================================================

begin;

create or replace function speichere_vip(
  p_anfrage_id  uuid,
  p_event_id    uuid,
  p_tisch       text,
  p_betrag_cent int,
  p_bezahlt     boolean,
  p_gaeste      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anfrage vip_anfragen%rowtype;
  v_tisch   text := nullif(trim(coalesce(p_tisch, '')), '');
  v_eintrag jsonb;
  v_name    text;
  v_id      uuid;
  v_gast    gaeste%rowtype;
  v_behalten uuid[] := '{}';
  v_anzahl  int;
begin
  if not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_anfrage from vip_anfragen where id = p_anfrage_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if not exists (select 1 from events where id = p_event_id) then
    return jsonb_build_object('ergebnis', 'event');
  end if;
  -- Sind Tickets für ein Event ausgestellt, bleibt es dabei. Ein anderes
  -- Event hieße: alle Tickets neu — das ist eine neue Buchung.
  if exists (select 1 from gaeste
              where vip_anfrage_id = p_anfrage_id and entfernt_am is null
                and event_id <> p_event_id) then
    return jsonb_build_object('ergebnis', 'event_fest');
  end if;
  if v_tisch is not null and length(v_tisch) > 40 then
    return jsonb_build_object('ergebnis', 'tisch');
  end if;
  if p_betrag_cent is not null and p_betrag_cent < 0 then
    return jsonb_build_object('ergebnis', 'betrag');
  end if;

  v_anzahl := jsonb_array_length(coalesce(p_gaeste, '[]'::jsonb));
  if v_anzahl < 1 or v_anzahl > 30 then
    return jsonb_build_object('ergebnis', 'anzahl');
  end if;
  -- Erst alles prüfen, dann ändern: Ein return mittendrin rollt nichts
  -- zurück, und eine halb geänderte Gästeliste wäre schlimmer als keine.
  for v_eintrag in select * from jsonb_array_elements(p_gaeste) loop
    v_name := trim(coalesce(v_eintrag ->> 'name', ''));
    if length(v_name) < 1 or length(v_name) > 120 then
      return jsonb_build_object('ergebnis', 'name');
    end if;
    if nullif(v_eintrag ->> 'id', '') is not null and not exists (
      select 1 from gaeste
       where id::text = v_eintrag ->> 'id'
         and vip_anfrage_id = p_anfrage_id and entfernt_am is null
    ) then
      return jsonb_build_object('ergebnis', 'unbekannt');
    end if;
  end loop;

  -- Wer nicht mehr auf der Liste steht, fliegt raus — außer er ist schon drin.
  select g.name into v_name
    from gaeste g
   where g.vip_anfrage_id = p_anfrage_id and g.entfernt_am is null
     and g.id::text not in (select coalesce(e ->> 'id', '') from jsonb_array_elements(p_gaeste) e)
     and exists (select 1 from tickets t where t.gast_id = g.id and t.status = 'entwertet')
   limit 1;
  if found then
    return jsonb_build_object('ergebnis', 'schon_drin', 'name', v_name);
  end if;

  for v_gast in
    select * from gaeste
     where vip_anfrage_id = p_anfrage_id and entfernt_am is null
       and id::text not in (
         select coalesce(e ->> 'id', '') from jsonb_array_elements(p_gaeste) e
       )
     for update
  loop
    update gaeste set entfernt_am = now() where id = v_gast.id;
    update tickets set status = 'storniert' where gast_id = v_gast.id and status = 'gueltig';
  end loop;

  for v_eintrag in select * from jsonb_array_elements(p_gaeste) loop
    v_name := trim(v_eintrag ->> 'name');
    v_id := nullif(v_eintrag ->> 'id', '')::uuid;

    if v_id is not null then
      update gaeste set name = v_name where id = v_id;
    else
      -- clock_timestamp statt now(): now() ist die Zeit der Transaktion, alle
      -- Gäste einer Buchung hätten dieselbe, und die Reihenfolge fiele auf
      -- die zufällige ID zurück (0029).
      insert into gaeste (event_id, name, begleitung, vip_anfrage_id, erstellt_von, erstellt_am)
      values (p_event_id, v_name, 0, p_anfrage_id, auth.uid(), clock_timestamp())
      returning id into v_id;
      insert into tickets (event_id, gast_id, phase_name, art, code)
      values (p_event_id, v_id, 'VIP', 'vip', neuer_ticketcode());
    end if;
    v_behalten := v_behalten || v_id;
  end loop;

  -- Name und Tisch stehen auf jedem Ticket — der Scanner zeigt beides.
  update tickets t
     set gast_name = g.name, platz = v_tisch
    from gaeste g
   where t.gast_id = g.id and g.id = any (v_behalten) and t.status <> 'storniert';

  update vip_anfragen
     set event_id    = p_event_id,
         tisch       = v_tisch,
         betrag_cent = p_betrag_cent,
         bezahlt     = coalesce(p_bezahlt, false),
         status      = 'bestaetigt',
         token       = coalesce(token,
                         replace(gen_random_uuid()::text, '-', '') ||
                         replace(gen_random_uuid()::text, '-', ''))
   where id = p_anfrage_id
  returning * into v_anfrage;

  return jsonb_build_object(
    'ergebnis', 'ok',
    'token', v_anfrage.token,
    'gaeste', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'token', g.token)
                                order by array_position(v_behalten, g.id)), '[]'::jsonb)
        from gaeste g where g.id = any (v_behalten)
    )
  );
end;
$$;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'speichere_vip'
                  and prosrc like '%clock_timestamp()%'
                  and prosrc like '%schon_drin%'
                  and prosrc like '%event_fest%') then
    raise exception 'speichere_vip() setzt die Reihenfolge nicht oder hat etwas verloren';
  end if;
  if has_function_privilege('anon', 'public.speichere_vip(uuid, uuid, text, int, boolean, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.speichere_vip(uuid, uuid, text, int, boolean, jsonb)', 'execute') then
    raise exception 'Rechte an speichere_vip() stimmen nicht';
  end if;
  if speichere_vip(gen_random_uuid(), gen_random_uuid(), null, null, false, '[]')
       ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'speichere_vip() lässt ohne Rolle etwas zu';
  end if;
end $$;
