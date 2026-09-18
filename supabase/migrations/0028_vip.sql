-- ============================================================
-- Lunar Events — VIP-Tickets auf Namen
--
-- Entscheidungen (Rückfragen 17.09.2026, Chat 18.09.2026):
--
--   * VIP bleibt eine Anfrage. Nach der Zusage stellt ein Admin die Tickets
--     aus — eines je Gast, jedes mit Namen ("Ja, jeder").
--   * Die Namen trägt nur der Admin im Backoffice ein, kein Link für den
--     Gastgeber.
--   * Bezahlt wird außerhalb des Systems (am Tisch, per Überweisung). Die
--     Buchung merkt sich nur den vereinbarten Betrag und ob er da ist — zur
--     Übersicht, nicht als Zahlung.
--   * Am Einlass keine Ausweiskontrolle (Fragebogen): Der Name steht auf
--     dem Ticket und in der Namensliste, damit man jemanden findet.
--
-- Jeder VIP-Gast ist ein Eintrag in `gaeste` (0021) ohne Begleitung, der an
-- der Anfrage hängt (`vip_anfrage_id`). Damit gilt alles, was die
-- Gästeliste schon kann, auch hier: ein echtes Ticket je Person, QR-Scan und
-- Namensliste entwerten dieselbe Zeile, Namensliste ohne Netz, und jeder
-- Gast hat seinen eigenen Link (`gaeste.token`). Die Gästeliste im
-- Backoffice zeigt diese Einträge nicht — sie werden über die Anfrage
-- gepflegt, und speichere_gast/entferne_gast lassen sie in Ruhe.
--
-- Wie die Gästeliste kommen VIP-Tickets obendrauf: Sie zählen nicht als
-- Verkauf und ziehen nichts von den Phasen ab.
-- ============================================================

begin;

-- ---------- Buchung an der Anfrage ----------
alter table vip_anfragen
  add column if not exists tisch       text check (tisch is null or length(tisch) between 1 and 40),
  add column if not exists betrag_cent int  check (betrag_cent is null or betrag_cent >= 0),
  add column if not exists bezahlt     boolean not null default false,
  -- Der Link für die anfragende Person: alle Tickets des Tisches auf einer
  -- Seite. Entsteht beim ersten Ausstellen.
  add column if not exists token       text,
  add column if not exists tickets_gesendet_am timestamptz;

create unique index if not exists vip_anfragen_token_idx on vip_anfragen (token)
  where token is not null;

-- ---------- Gäste gehören zur Anfrage ----------
-- restrict: Eine Anfrage mit ausgestellten Tickets verschwindet nicht still.
alter table gaeste
  add column if not exists vip_anfrage_id uuid references vip_anfragen (id) on delete restrict;

create index if not exists gaeste_vip_idx on gaeste (vip_anfrage_id)
  where vip_anfrage_id is not null;

-- ---------- Gästeliste lässt VIP-Einträge in Ruhe ----------
create or replace function speichere_gast(
  p_id         uuid,
  p_event_id   uuid,
  p_name       text,
  p_email      text,
  p_begleitung int,
  p_notiz      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_email  citext := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_gast   gaeste%rowtype;
  v_soll   int;
  v_aktiv  int;
  v_drin   int;
  v_i      int;
begin
  if not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    return jsonb_build_object('ergebnis', 'name');
  end if;
  if p_begleitung is null or p_begleitung < 0 or p_begleitung > 10 then
    return jsonb_build_object('ergebnis', 'begleitung');
  end if;

  v_soll := 1 + p_begleitung;

  if p_id is null then
    if not exists (select 1 from events where id = p_event_id) then
      return jsonb_build_object('ergebnis', 'unbekannt');
    end if;
    insert into gaeste (event_id, name, email, begleitung, notiz, erstellt_von)
    values (p_event_id, v_name, v_email, p_begleitung,
            nullif(trim(coalesce(p_notiz, '')), ''), auth.uid())
    returning * into v_gast;
  else
    -- VIP-Gäste (0028) werden über ihre Anfrage gepflegt.
    select * into v_gast from gaeste
     where id = p_id and entfernt_am is null and vip_anfrage_id is null
       for update;
    if not found then
      return jsonb_build_object('ergebnis', 'unbekannt');
    end if;
    select count(*) into v_drin from tickets where gast_id = v_gast.id and status = 'entwertet';
    if v_soll < v_drin then
      return jsonb_build_object('ergebnis', 'schon_drin', 'drin', v_drin);
    end if;
    update gaeste
       set name = v_name,
           email = v_email,
           begleitung = p_begleitung,
           notiz = nullif(trim(coalesce(p_notiz, '')), '')
     where id = v_gast.id
    returning * into v_gast;
  end if;

  -- Tickets angleichen
  select count(*) into v_aktiv from tickets where gast_id = v_gast.id and status <> 'storniert';

  for v_i in 1..greatest(v_soll - v_aktiv, 0) loop
    insert into tickets (event_id, gast_id, phase_name, art, code)
    values (v_gast.event_id, v_gast.id, 'Gästeliste', 'standard', neuer_ticketcode());
  end loop;

  if v_aktiv > v_soll then
    update tickets set status = 'storniert'
     where id in (
       select id from tickets
        where gast_id = v_gast.id and status = 'gueltig'
        order by erstellt_am desc, id desc
        limit v_aktiv - v_soll
     );
  end if;

  -- Namen auf den Tickets: der Gast selbst auf dem ersten, "Begleitung" auf
  -- den übrigen. So steht es auch auf der Ticketseite.
  update tickets t
     set gast_name = case when r.nr = 1 then v_gast.name
                          else v_gast.name || ' · Begleitung' end
    from (
      select id, row_number() over (order by erstellt_am, id) as nr
        from tickets
       where gast_id = v_gast.id and status <> 'storniert'
    ) r
   where t.id = r.id;

  return jsonb_build_object('ergebnis', 'ok', 'id', v_gast.id, 'token', v_gast.token);
end;
$$;

create or replace function entferne_gast(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  update gaeste set entfernt_am = coalesce(entfernt_am, now())
   where id = p_id and vip_anfrage_id is null;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  update tickets set status = 'storniert' where gast_id = p_id and status = 'gueltig';
  return jsonb_build_object('ergebnis', 'ok');
end;
$$;

-- ---------- Namensliste am Einlass: VIP mit Tisch ----------
create or replace function gaesteliste_einlass(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('einlass') then '[]'::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'name', g.name,
               'notiz', g.notiz,
               -- VIP (0028): der Tisch, sonst null.
               'vip', g.vip_anfrage_id is not null,
               'tisch', (select v.tisch from vip_anfragen v where v.id = g.vip_anfrage_id),
               'personen', (select count(*) from tickets t
                             where t.gast_id = g.id and t.status <> 'storniert'),
               'drin', (select count(*) from tickets t
                         where t.gast_id = g.id and t.status = 'entwertet'))
             order by lower(g.name))
        from gaeste g
       where g.event_id = p_event_id and g.entfernt_am is null
    ), '[]'::jsonb)
  end;
$$;

-- ---------- Ausstellen und ändern ----------
-- p_gaeste: die vollständige Liste, wie sie danach sein soll —
--   [{ "id": uuid | null, "name": text }, …]
-- Mit id wird ein bestehender Gast umbenannt, ohne id kommt einer dazu,
-- wer fehlt, wird entfernt (seine Tickets storniert). Wer schon drin ist,
-- lässt sich nicht entfernen.
--   ergebnis: ok (mit token und gaeste) | keine_berechtigung | unbekannt |
--             event | event_fest | name | anzahl | schon_drin (mit name)
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
      insert into gaeste (event_id, name, begleitung, vip_anfrage_id, erstellt_von)
      values (p_event_id, v_name, 0, p_anfrage_id, auth.uid())
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

-- Alle VIP-Tickets einer Buchung zurücknehmen (Absage). Wer schon drin ist,
-- bleibt als eingelassen stehen.
create or replace function storniere_vip(p_anfrage_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anzahl int;
begin
  if not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  update tickets set status = 'storniert'
   where status = 'gueltig'
     and gast_id in (select id from gaeste where vip_anfrage_id = p_anfrage_id);
  get diagnostics v_anzahl = row_count;
  update gaeste set entfernt_am = coalesce(entfernt_am, now())
   where vip_anfrage_id = p_anfrage_id
     and not exists (select 1 from tickets t where t.gast_id = gaeste.id and t.status = 'entwertet');
  return jsonb_build_object('ergebnis', 'ok', 'storniert', v_anzahl);
end;
$$;

-- ---------- Rechte (siehe 0012) ----------
revoke execute on function speichere_vip(uuid, uuid, text, int, boolean, jsonb) from public, anon;
revoke execute on function storniere_vip(uuid) from public, anon;
grant execute on function speichere_vip(uuid, uuid, text, int, boolean, jsonb) to authenticated, service_role;
grant execute on function storniere_vip(uuid) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  f text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'gaeste' and column_name = 'vip_anfrage_id')
     or not exists (select 1 from information_schema.columns
                     where table_name = 'vip_anfragen' and column_name = 'token') then
    raise exception 'VIP-Spalten fehlen';
  end if;

  if not exists (select 1 from pg_proc where proname = 'speichere_gast'
                  and prosrc like '%vip_anfrage_id is null%')
     or not exists (select 1 from pg_proc where proname = 'entferne_gast'
                     and prosrc like '%vip_anfrage_id is null%') then
    raise exception 'Die Gästeliste könnte VIP-Einträge ändern';
  end if;
  if not exists (select 1 from pg_proc where proname = 'gaesteliste_einlass'
                  and prosrc like '%tisch%'
                  and prosrc like '%entfernt_am is null%') then
    raise exception 'Namensliste kennt VIP nicht oder hat etwas verloren';
  end if;

  if speichere_vip(gen_random_uuid(), gen_random_uuid(), null, null, false, '[]')
       ->> 'ergebnis' <> 'keine_berechtigung'
     or storniere_vip(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or speichere_gast(null, gen_random_uuid(), 'X', null, 0, null) ->> 'ergebnis'
       <> 'keine_berechtigung'
     or entferne_gast(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or gaesteliste_einlass(gen_random_uuid()) <> '[]'::jsonb then
    raise exception 'VIP oder Gästeliste lässt ohne Rolle etwas zu';
  end if;

  foreach f in array array[
    'public.speichere_vip(uuid, uuid, text, int, boolean, jsonb)',
    'public.storniere_vip(uuid)',
    'public.speichere_gast(uuid, uuid, text, text, int, text)',
    'public.entferne_gast(uuid)',
    'public.gaesteliste_einlass(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% ist ohne Anmeldung aufrufbar', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist für angemeldetes Personal nicht aufrufbar', f;
    end if;
  end loop;
end $$;
