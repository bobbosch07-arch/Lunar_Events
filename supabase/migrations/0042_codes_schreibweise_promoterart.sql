-- ============================================================
-- Lunar Events — Codes in eigener Schreibweise, Rabattart „promoter“
-- (06.10.2026)
--
-- 1. `code_anzeige` hält einen Code so, wie er angelegt wurde („Niklas“).
--    Verglichen wird weiter über `code` in Großbuchstaben: Alle Funktionen
--    machen aus der Eingabe des Gastes Großbuchstaben, „niklas“, „NIKLAS“
--    und „Niklas“ treffen also denselben Code. reserviere() und die Kasse
--    bleiben deshalb unberührt.
-- 2. Rabattart „promoter“ (Wert aus 0041) statt „Betrag 0 € mit Promoter“
--    aus 0040: ein Code, der nur zählt. Er hat immer 0 € und gehört immer
--    einem Promoter. code_rabatt() rechnet ihn ohne Änderung (er fällt in
--    den Zweig für Beträge, mit 0).
-- ============================================================

begin;

-- ---------- 1. Eigene Schreibweise ----------
alter table rabattcodes
  add column if not exists code_anzeige text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rabattcodes_anzeige') then
    alter table rabattcodes add constraint rabattcodes_anzeige check (
      code_anzeige is null
      or (upper(code_anzeige) = code and code_anzeige ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$')
    );
  end if;
end $$;

-- ---------- 2. Rabattart „promoter“ ----------
-- Was 0040 als 0-€-Betrag mit Promoter angelegt hat, wird zur neuen Art.
update rabattcodes
   set art = 'promoter'
 where art = 'betrag' and wert = 0 and promoter_id is not null;

alter table rabattcodes drop constraint if exists rabattcodes_wert;
alter table rabattcodes add constraint rabattcodes_wert check (
  wert >= 0
  and (art <> 'prozent' or wert <= 100)
  and (art <> 'promoter' or (wert = 0 and promoter_id is not null))
  and (wert > 0 or oeffnet_presale or art = 'promoter')
);

-- ---------- Kasse: Schreibweise mitliefern ----------
create or replace function pruefe_rabattcode(
  p_code     text,
  p_event_id uuid,
  p_auswahl  jsonb,
  p_fastlane int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text    text := upper(trim(coalesce(p_code, '')));
  v_code    rabattcodes%rowtype;
  v_event   events%rowtype;
  v_phase   phasen%rowtype;
  v_eintrag jsonb;
  v_menge   int;
  v_posten  jsonb := '[]'::jsonb;
  v_summe   int := 0;
  v_gebuehr int := 0;
  v_alle    int := 0;
  v_rabatt  int;
  v_anzahl  int;
begin
  if v_text = '' then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  select * into v_code from rabattcodes where code = v_text;
  if not found or not v_code.aktiv then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_code.gueltig_ab is not null and v_code.gueltig_ab > now() then
    return jsonb_build_object('ergebnis', 'noch_nicht', 'ab', v_code.gueltig_ab);
  end if;
  if v_code.gueltig_bis is not null and v_code.gueltig_bis < now() then
    return jsonb_build_object('ergebnis', 'abgelaufen');
  end if;
  if v_code.event_id is not null and v_code.event_id <> p_event_id then
    return jsonb_build_object('ergebnis', 'anderes_event');
  end if;
  if v_code.max_tickets is not null and v_code.eingeloest >= v_code.max_tickets then
    return jsonb_build_object('ergebnis', 'aufgebraucht');
  end if;

  for v_eintrag in select * from jsonb_array_elements(coalesce(p_auswahl, '[]'::jsonb)) loop
    v_menge := (v_eintrag ->> 'menge')::int;
    continue when v_menge is null or v_menge <= 0;

    select * into v_phase
      from phasen
     where id = (v_eintrag ->> 'phase_id')::uuid
       and event_id = p_event_id;
    continue when not found or v_phase.art = 'vip';

    v_posten := v_posten || jsonb_build_array(jsonb_build_object(
      'phase_id', v_phase.id, 'menge', v_menge, 'einzelpreis_cent', v_phase.preis_cent));
    v_summe   := v_summe   + v_phase.preis_cent   * v_menge;
    v_gebuehr := v_gebuehr + v_phase.gebuehr_cent * v_menge;
    v_alle    := v_alle    + v_menge;
  end loop;

  select r.rabatt, r.anzahl into v_rabatt, v_anzahl from code_rabatt(v_code, v_posten) r;

  if v_anzahl = 0 then
    return jsonb_build_object('ergebnis', 'passt_nicht');
  end if;

  if coalesce(p_fastlane, 0) > 0 then
    select * into v_event from events where id = p_event_id;
    if v_event.fastlane_aktiv then
      v_summe := v_summe + v_event.fastlane_preis_cent * p_fastlane;
    end if;
  end if;

  return jsonb_build_object(
    'ergebnis', 'ok',
    'code', v_code.code,
    'anzeige', coalesce(v_code.code_anzeige, v_code.code),
    'art', v_code.art,
    'wert', v_code.wert,
    'rabatt_cent', rabatt_ohne_kleinstbetrag(v_rabatt, v_summe + v_gebuehr),
    'tickets', v_anzahl,
    'tickets_gesamt', v_alle,
    'oeffnet_presale', v_code.oeffnet_presale
  );
end;
$$;

revoke execute on function pruefe_rabattcode(text, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function pruefe_rabattcode(text, uuid, jsonb, int) to service_role;

-- ---------- Promoterseite: Schreibweise mitliefern ----------
create or replace function promoter_statistik(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p promoter%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into v_p from promoter where token = p_token;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'name', v_p.name,
    'kuerzel', v_p.kuerzel,
    'aktiv', v_p.aktiv,
    'events', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.beginn desc)
        from (
          select e.id,
                 e.titel,
                 e.slug,
                 e.beginn,
                 (e.status = 'veroeffentlicht' and e.beginn > now()) as kommend,
                 (select count(*)
                    from ereignisse x
                   where x.promoter_id = v_p.id
                     and x.event_id = e.id
                     and x.art = 'event_gesehen')::int as klicks,
                 promoter_tickets(v_p.id, e.id) as tickets,
                 promoter_tickets(v_p.id, e.id, e.promo_stichtag) as tickets_staffel,
                 e.promo_stichtag as stichtag,
                 (select jsonb_build_object(
                           'link',    count(t.id) filter (where b.promoter_weg = 'link'),
                           'code',    count(t.id) filter (where b.promoter_weg = 'code'),
                           'beides',  count(t.id) filter (where b.promoter_weg = 'beides'),
                           'frueher', count(t.id) filter (where b.promoter_weg is null))
                    from bestellungen b
                    join tickets t on t.bestellung_id = b.id and t.status <> 'storniert'
                   where b.promoter_id = v_p.id
                     and b.event_id = e.id
                     and b.status = 'bezahlt') as weg,
                 coalesce((select jsonb_agg(jsonb_build_object('ab', s.ab_tickets, 'belohnung', s.belohnung)
                                            order by s.ab_tickets)
                             from promoter_stufen s
                            where s.event_id = e.id), '[]'::jsonb) as stufen
            from events e
           where (e.status = 'veroeffentlicht' and e.beginn > now())
              or exists (select 1 from bestellungen b
                          where b.promoter_id = v_p.id and b.event_id = e.id
                            and b.status = 'bezahlt')
              or exists (select 1 from ereignisse x
                          where x.promoter_id = v_p.id and x.event_id = e.id)
        ) z
    ), '[]'::jsonb),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'anzeige', coalesce(r.code_anzeige, r.code),
               'art', r.art, 'wert', r.wert, 'event_id', r.event_id)
             order by r.code)
        from rabattcodes r
       where r.promoter_id = v_p.id
         and r.aktiv
         and (r.gueltig_ab is null or r.gueltig_ab <= now())
         and (r.gueltig_bis is null or r.gueltig_bis > now())
         and (r.max_tickets is null or r.eingeloest < r.max_tickets)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function promoter_statistik(text) from public, anon, authenticated;
grant execute on function promoter_statistik(text) to service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_p uuid;
  v_ort uuid;
  v_event uuid;
  v_ph uuid;
  v_vorschau jsonb;
begin
  insert into promoter (name, kuerzel) values ('Selbsttest', 'selbsttest-' || substr(md5(random()::text), 1, 8))
    returning id into v_p;

  -- Art promoter braucht 0 € und einen Promoter.
  begin
    insert into rabattcodes (code, art, wert, promoter_id) values ('SELBST0042A', 'promoter', 100, v_p);
    raise exception 'Promoter-Code mit Rabatt angenommen';
  exception when check_violation then null;
  end;
  begin
    insert into rabattcodes (code, art, wert) values ('SELBST0042B', 'promoter', 0);
    raise exception 'Promoter-Code ohne Promoter angenommen';
  exception when check_violation then null;
  end;
  -- Ein Betrag von 0 € ohne Presale gibt es jetzt nur noch als Art promoter.
  begin
    insert into rabattcodes (code, art, wert, promoter_id) values ('SELBST0042C', 'betrag', 0, v_p);
    raise exception 'Betrag 0 € ohne Presale angenommen';
  exception when check_violation then null;
  end;
  -- Schreibweise muss zum Code passen.
  begin
    insert into rabattcodes (code, code_anzeige, art, wert, promoter_id) values ('SELBST0042D', 'Anders', 'promoter', 0, v_p);
    raise exception 'Fremde Schreibweise angenommen';
  exception when check_violation then null;
  end;

  insert into rabattcodes (code, code_anzeige, art, wert, promoter_id)
    values ('SELBST0042E', 'Selbst0042e', 'promoter', 0, v_p);

  select id into v_ort from orte limit 1;
  insert into events (slug, titel, kategorie, status, beginn, ort_id, veranstalter)
    values ('selbsttest-0042-' || gen_random_uuid(), 'SELBSTTEST', 'club', 'veroeffentlicht', now() + interval '30 days', v_ort, 'Lunar Events')
    returning id into v_event;
  insert into phasen (event_id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, aktiv, leistungen, position)
    values (v_event, 'Test', 'standard', 1000, 100, 10, 0, true, '{}', 0)
    returning id into v_ph;

  -- Kleingeschrieben eingegeben, trotzdem gefunden, ohne Rabatt.
  v_vorschau := pruefe_rabattcode('selbst0042e', v_event, jsonb_build_array(jsonb_build_object('phase_id', v_ph, 'menge', 2)));
  if v_vorschau ->> 'ergebnis' <> 'ok'
     or (v_vorschau ->> 'rabatt_cent')::int <> 0
     or v_vorschau ->> 'anzeige' <> 'Selbst0042e'
     or v_vorschau ->> 'art' <> 'promoter' then
    raise exception 'Vorschau für Promoter-Code falsch: %', v_vorschau;
  end if;

  delete from phasen where id = v_ph;
  delete from events where id = v_event;
  delete from rabattcodes where code like 'SELBST0042%';
  delete from promoter where id = v_p;

  if has_function_privilege('anon', 'public.pruefe_rabattcode(text, uuid, jsonb, int)', 'execute') then
    raise exception 'pruefe_rabattcode ist öffentlich aufrufbar';
  end if;
  if has_function_privilege('anon', 'public.promoter_statistik(text)', 'execute') then
    raise exception 'promoter_statistik ist öffentlich aufrufbar';
  end if;
end $$;
