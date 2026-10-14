-- ============================================================
-- Lunar Events — Einlass härten (14.10.2026)
--
-- Gefunden im Lasttest (scripts/einlass-last.mjs, 1000 Tickets, 6 Geräte):
--
-- 1. Ein Ticket eines ANDEREN Events wurde eingelassen und dabei entwertet.
--    Wer ein Ticket fürs nächste Event zeigt, käme heute rein und stünde dann
--    dort vor "Schon drin". entwerte_ticket bekommt das gewählte Event und
--    antwortet bei Abweichung mit "anderes_event", ohne etwas zu ändern
--    (entschieden 14.10.: abweisen mit Hinweis).
-- 2. einlass_pruefsummen lieferte höchstens 1000 Zeilen (Obergrenze der
--    Schnittstelle für Mengen-Antworten). Ohne Netz wäre bei großen Events
--    jedes Ticket darüber "Unbekannt". Jetzt ein einziger Wert (Array).
-- 3. Neu: "Nur prüfen" für Admins (entschieden 14.10.): dieselbe Antwort wie
--    beim Einlass, aber nichts wird entwertet. Damit lassen sich echte
--    Tickets testen, ohne sie zu verbrauchen.
-- 4. Neu: einlass_nachtragen, alle ohne Netz gesammelten Scans in einem
--    Aufruf. Vorher einzeln, und neue Scans warteten dahinter.
-- 5. Neu: einlass_liste, alles für den Betrieb ohne Netz in einem Abruf,
--    auch die schon eingelassenen Tickets ("Schon drin" statt "Unbekannt").
--    einlass_pruefsummen und einlass_namen bleiben für den laufenden Code.
--
-- entwerte_ticket muss dafür neu angelegt werden (neue Parameter). Beide
-- neuen haben Voreinstellungen: Ein Aufruf nur mit p_code, wie ihn der noch
-- laufende Code macht, funktioniert weiter wie bisher.
-- ============================================================

begin;

drop function if exists entwerte_ticket(text);

create or replace function entwerte_ticket(
  p_code        text,
  -- Das Event, für das gerade eingelassen wird. Null: keine Prüfung (alter
  -- Aufruf, und "Nur prüfen", das jedes Ticket erklären soll).
  p_event_id    uuid default null,
  -- Nur Admins: alles prüfen, nichts entwerten.
  p_nur_pruefen boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket     tickets%rowtype;
  v_event      events%rowtype;
  v_name_fehlt boolean;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if p_nur_pruefen and not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_ticket from tickets where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  select * into v_event from events where id = v_ticket.event_id;

  -- Falsches Event: nicht einlassen, nichts ändern. Titel und Beginn, damit
  -- der Einlass dem Gast sagen kann, wofür sein Ticket gilt.
  if p_event_id is not null and v_ticket.event_id <> p_event_id then
    return jsonb_build_object('ergebnis', 'anderes_event',
      'event', v_event.titel, 'beginn', v_event.beginn, 'typ', v_ticket.phase_name);
  end if;

  v_name_fehlt := v_ticket.gast_name is null
    and v_ticket.bestellung_id is not null
    and not coalesce((select abendkasse from bestellungen where id = v_ticket.bestellung_id), false);

  if v_ticket.status = 'storniert' then
    return jsonb_build_object('ergebnis', 'storniert',
      'event', v_event.titel, 'typ', v_ticket.phase_name,
      'gast', v_ticket.gast_name, 'probe', p_nur_pruefen);
  end if;

  if v_ticket.status = 'entwertet' then
    return jsonb_build_object('ergebnis', 'schon_entwertet',
      'event', v_event.titel, 'typ', v_ticket.phase_name,
      'fastlane', v_ticket.fastlane,
      'gast', v_ticket.gast_name,
      'name_fehlt', v_name_fehlt,
      'zeitpunkt', v_ticket.entwertet_am,
      'probe', p_nur_pruefen);
  end if;

  if not p_nur_pruefen then
    update tickets
       set status        = 'entwertet',
           entwertet_am  = now(),
           entwertet_von = auth.uid()
     where id = v_ticket.id;
  end if;

  return jsonb_build_object('ergebnis', 'gueltig',
    'event', v_event.titel,
    'typ', v_ticket.phase_name,
    'art', v_ticket.art,
    'fastlane', v_ticket.fastlane,
    'gast', v_ticket.gast_name,
    'name_fehlt', v_name_fehlt,
    'platz', v_ticket.platz,
    'probe', p_nur_pruefen);
end;
$$;

revoke all on function entwerte_ticket(text, uuid, boolean) from public, anon;
grant execute on function entwerte_ticket(text, uuid, boolean) to authenticated, service_role;

-- ---------- Prüfsummen als ein Wert ----------
drop function if exists einlass_pruefsummen(uuid);

create or replace function einlass_pruefsummen(p_event_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(einlass_pruefsumme(t.code)), '{}'::text[])
    from tickets t
   where ist_mitarbeiter('einlass')
     and t.event_id = p_event_id
     and t.status = 'gueltig';
$$;

revoke all on function einlass_pruefsummen(uuid) from public, anon;
grant execute on function einlass_pruefsummen(uuid) to authenticated, service_role;

-- ---------- Alles für den Betrieb ohne Netz in einem Abruf ----------
-- Gültige und schon eingelassene Tickets als Prüfsummen, dazu die Namen.
-- Mit "drin" sagt das Gerät ohne Netz "Schon drin" statt "Unbekannt", wenn
-- ein anderes Gerät das Ticket vorher eingelassen hat. Ein einzelner Wert,
-- also ohne die 1000er-Grenze.
create or replace function einlass_liste(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('einlass') then
           jsonb_build_object('gueltig', '[]'::jsonb, 'drin', '[]'::jsonb, 'namen', '{}'::jsonb)
         else jsonb_build_object(
           'gueltig', coalesce((select jsonb_agg(einlass_pruefsumme(code)) from tickets
                                 where event_id = p_event_id and status = 'gueltig'), '[]'::jsonb),
           'drin', coalesce((select jsonb_agg(einlass_pruefsumme(code)) from tickets
                              where event_id = p_event_id and status = 'entwertet'), '[]'::jsonb),
           'namen', coalesce((select jsonb_object_agg(einlass_pruefsumme(code), gast_name) from tickets
                               where event_id = p_event_id and status <> 'storniert'
                                 and gast_name is not null), '{}'::jsonb))
         end;
$$;

revoke all on function einlass_liste(uuid) from public, anon;
grant execute on function einlass_liste(uuid) to authenticated, service_role;

-- ---------- Ohne Netz gesammelte Scans nachtragen ----------
-- Je Code dasselbe wie ein Scan, mit dem Event des Geräts. Antwortet je Code
-- mit dem Ergebnis. "schon_entwertet" mit eigenes = false heißt: Ein anderes
-- Konto hat das Ticket vorher eingelassen, es kam also zweimal rein. Das
-- soll der Einlass erfahren. eigenes = true ist harmlos: Der Scan war beim
-- Gerät zu langsam, kam aber doch an. Höchstens 500 je Aufruf.
create or replace function einlass_nachtragen(p_codes text[], p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_erg   jsonb;
  v_liste jsonb := '[]'::jsonb;
begin
  if coalesce(array_length(p_codes, 1), 0) > 500 then
    raise exception 'ZU_VIELE';
  end if;
  foreach v_code in array coalesce(p_codes, '{}'::text[]) loop
    v_erg := entwerte_ticket(v_code, p_event_id, false);
    v_liste := v_liste || jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'ergebnis', v_erg->>'ergebnis',
      'gast', v_erg->>'gast',
      'eigenes', v_erg->>'ergebnis' = 'schon_entwertet' and exists (
        select 1 from tickets
         where code = upper(btrim(v_code)) and entwertet_von = auth.uid())));
  end loop;
  return v_liste;
end;
$$;

revoke all on function einlass_nachtragen(text[], uuid) from public, anon;
grant execute on function einlass_nachtragen(text[], uuid) to authenticated, service_role;

-- ---------- Selbstprüfung ----------
do $$
begin
  if (select count(*) from pg_proc where proname = 'entwerte_ticket') <> 1 then
    raise exception 'entwerte_ticket gibt es nicht genau einmal';
  end if;
  if not exists (select 1 from pg_proc where proname = 'entwerte_ticket'
                  and prosrc like '%anderes_event%' and prosrc like '%p_nur_pruefen%'
                  and prosrc like '%name_fehlt%') then
    raise exception 'entwerte_ticket ohne Eventprüfung, Nur-prüfen oder Namen';
  end if;
  if (select prorettype from pg_proc where proname = 'einlass_pruefsummen') <> 'text[]'::regtype then
    raise exception 'einlass_pruefsummen liefert keinen einzelnen Wert';
  end if;
  if has_function_privilege('anon', 'entwerte_ticket(text, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'einlass_pruefsummen(uuid)', 'execute')
     or has_function_privilege('anon', 'einlass_nachtragen(text[], uuid)', 'execute')
     or has_function_privilege('anon', 'einlass_liste(uuid)', 'execute') then
    raise exception 'Einlass-Funktionen für anon aufrufbar';
  end if;
  if not has_function_privilege('authenticated', 'entwerte_ticket(text, uuid, boolean)', 'execute') then
    raise exception 'Personal kann entwerte_ticket nicht aufrufen';
  end if;
  -- Ohne Anmeldung: keine Berechtigung, nie eine Ausnahme.
  if entwerte_ticket('XYZ') ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'entwerte_ticket ohne Anmeldung antwortet falsch';
  end if;
end $$;

commit;
