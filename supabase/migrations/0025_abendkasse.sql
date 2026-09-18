-- ============================================================
-- Lunar Events — Abendkasse
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Der Preis an der Tür steht in einer **eigenen Phase** je Event
--     (`phasen.abendkasse`) — eigener Preis, eigenes Kontingent, wie Early
--     Bird, nur eben für die Tür. Online ist sie unsichtbar und unkaufbar.
--   * Verkauft wird bar oder über einen QR-Code, den der Gast mit seinem
--     eigenen Handy bezahlt. Kein Kartenleser (Stand 17.09.2026).
--   * Nach dem Verkauf wird sofort eingelassen: Die Person steht ja vor
--     einem. Das Ticket ist damit entwertet.
--
-- Bargeld heißt: Die Bestellung ist im selben Moment bezahlt. Es gibt keine
-- Reservierung, nichts kann verfallen — deshalb eine eigene Funktion statt
-- `reserviere()`. Beide sperren dieselbe Phase (`select … for update`), also
-- lässt sich auch an der Tür nichts überverkaufen.
-- ============================================================

begin;

-- ---------- Phase nur für die Tür ----------
alter table phasen add column if not exists abendkasse boolean not null default false;

-- ---------- Merkmal an der Bestellung ----------
-- Damit der Kassenbericht Bargeld und QR-Zahlungen zusammen findet, egal
-- welche Zahlungsart daraus wurde.
alter table bestellungen add column if not exists abendkasse boolean not null default false;

create index if not exists bestellungen_abendkasse_idx
  on bestellungen (event_id, bezahlt_am) where abendkasse;

-- ---------- Reservierung: Türphasen bleiben online zu ----------
create or replace function reserviere(
  p_event_id   uuid,
  p_auswahl    jsonb,
  p_email      text,
  p_vorname    text default null,
  p_nachname   text default null,
  p_telefon    text default null,
  p_minuten    int default 15,
  p_fastlane   int default 0,
  p_code       text default null,
  p_einladung  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunde_id      uuid;
  v_bestellung_id uuid;
  v_eintrag       jsonb;
  v_phase         phasen%rowtype;
  v_menge         int;
  v_summe         int := 0;
  v_gebuehr       int := 0;
  v_tickets       int := 0;
  v_event         events%rowtype;
  v_code_text     text := upper(trim(coalesce(p_code, '')));
  v_code          rabattcodes%rowtype;
  v_posten        jsonb;
  v_code_rabatt   int := 0;
  v_code_tickets  int := 0;
  v_einladung_id  uuid;
  v_eingeladen    citext;
begin
  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'veroeffentlicht' then
    raise exception 'EVENT_NICHT_VERFUEGBAR';
  end if;
  if v_event.beginn < now() then
    raise exception 'EVENT_VORBEI';
  end if;
  if coalesce(p_fastlane, 0) < 0 then
    raise exception 'MENGE_UNGUELTIG';
  end if;

  -- ---------- Verkaufsstart und Presale (0019) ----------
  if v_event.verkauf_ab is not null and v_event.verkauf_ab > now() then
    if v_event.presale_ab is null or v_event.presale_ab > now() then
      raise exception 'VERKAUF_NOCH_NICHT';
    end if;

    if nullif(trim(coalesce(p_einladung, '')), '') is not null then
      select e.id, k.email into v_einladung_id, v_eingeladen
        from presale_einladungen e
        join kunden k on k.id = e.kunde_id
       where e.token = trim(p_einladung)
         and e.event_id = p_event_id;
      if v_einladung_id is not null and v_eingeladen <> p_email::citext then
        v_einladung_id := null;
        if not exists (
          select 1 from rabattcodes r
           where r.code = v_code_text and r.aktiv and r.oeffnet_presale
        ) then
          raise exception 'PRESALE_ANDERE_ADRESSE';
        end if;
      end if;
    end if;

    if v_einladung_id is null and not exists (
      select 1 from rabattcodes r
       where r.code = v_code_text
         and r.aktiv
         and r.oeffnet_presale
         and (r.event_id is null or r.event_id = p_event_id)
         and (r.gueltig_ab is null or r.gueltig_ab <= now())
         and (r.gueltig_bis is null or r.gueltig_bis >= now())
    ) then
      raise exception 'PRESALE_ZUGANG_FEHLT';
    end if;
  end if;

  insert into kunden (email, vorname, nachname, telefon)
       values (p_email, p_vorname, p_nachname, p_telefon)
  on conflict (email) do update
     set vorname  = coalesce(excluded.vorname, kunden.vorname),
         nachname = coalesce(excluded.nachname, kunden.nachname),
         telefon  = coalesce(excluded.telefon, kunden.telefon)
  returning id into v_kunde_id;

  insert into bestellungen (nummer, event_id, kunde_id, status, reserviert_bis)
       values (neue_bestellnummer(), p_event_id, v_kunde_id, 'offen',
               now() + make_interval(mins => p_minuten))
  returning id into v_bestellung_id;

  for v_eintrag in select * from jsonb_array_elements(p_auswahl) loop
    v_menge := (v_eintrag ->> 'menge')::int;
    if v_menge is null or v_menge <= 0 then
      raise exception 'MENGE_UNGUELTIG';
    end if;

    select * into v_phase
      from phasen
     where id = (v_eintrag ->> 'phase_id')::uuid
       and event_id = p_event_id
       for update;

    if not found then
      raise exception 'PHASE_UNBEKANNT';
    end if;
    if v_phase.art = 'vip' then
      raise exception 'VIP_NUR_AUF_ANFRAGE';
    end if;
    -- Neu in 0025: Was für die Tür gedacht ist, gibt es online nicht.
    if v_phase.abendkasse then
      raise exception 'PHASE_NUR_ABENDKASSE';
    end if;
    if not v_phase.aktiv
       or (v_phase.ab is not null and v_phase.ab > now())
       or (v_phase.bis is not null and v_phase.bis < now()) then
      raise exception 'PHASE_NICHT_KAUFBAR';
    end if;

    -- Phasenfolge (0010) — Türphasen zählen dabei nicht mit, sonst
    -- blockierte eine Abendkasse mit Restkarten den Online-Verkauf.
    if exists (
      select 1
        from phasen vor
       where vor.event_id = p_event_id
         and vor.art = 'standard'
         and vor.aktiv
         and not vor.abendkasse
         and (vor.position < v_phase.position
              or (vor.position = v_phase.position and vor.id::text < v_phase.id::text))
         and (vor.ab is null or vor.ab <= now())
         and (vor.bis is null or vor.bis >= now())
         and (vor.kontingent is null or vor.verkauft < vor.kontingent)
    ) then
      raise exception 'PHASE_NICHT_KAUFBAR';
    end if;

    if v_phase.kontingent is not null
       and v_phase.verkauft + v_menge > v_phase.kontingent then
      raise exception 'NICHT_GENUG_TICKETS:%:%',
        v_phase.name, greatest(v_phase.kontingent - v_phase.verkauft, 0);
    end if;

    update phasen set verkauft = verkauft + v_menge where id = v_phase.id;

    insert into bestellpositionen
      (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
    values
      (v_bestellung_id, v_phase.id, v_phase.name, v_menge,
       v_phase.preis_cent, v_phase.gebuehr_cent);

    v_summe   := v_summe   + v_phase.preis_cent * v_menge;
    v_gebuehr := v_gebuehr + v_phase.gebuehr_cent * v_menge;
    v_tickets := v_tickets + v_menge;
  end loop;

  -- ---------- Fast Lane (0011) ----------
  if coalesce(p_fastlane, 0) > 0 then
    select * into v_event from events where id = p_event_id for update;

    if not v_event.fastlane_aktiv then
      raise exception 'FASTLANE_NICHT_VERFUEGBAR';
    end if;
    if p_fastlane > v_tickets then
      raise exception 'FASTLANE_MENGE';
    end if;
    if v_event.fastlane_kontingent is not null
       and v_event.fastlane_verkauft + p_fastlane > v_event.fastlane_kontingent then
      raise exception 'FASTLANE_AUSVERKAUFT:%',
        greatest(v_event.fastlane_kontingent - v_event.fastlane_verkauft, 0);
    end if;

    update events
       set fastlane_verkauft = fastlane_verkauft + p_fastlane
     where id = p_event_id;

    update bestellungen
       set fastlane_menge      = p_fastlane,
           fastlane_preis_cent = v_event.fastlane_preis_cent
     where id = v_bestellung_id;

    v_summe := v_summe + v_event.fastlane_preis_cent * p_fastlane;
  end if;

  if v_summe = 0 and v_gebuehr = 0
     and not exists (select 1 from bestellpositionen
                      where bestellung_id = v_bestellung_id) then
    raise exception 'AUSWAHL_LEER';
  end if;

  -- ---------- Rabattcode (0016) ----------
  if v_code_text <> '' then
    select * into v_code from rabattcodes where code = v_code_text for update;

    if not found or not v_code.aktiv then
      raise exception 'CODE_UNBEKANNT';
    end if;
    if v_code.gueltig_ab is not null and v_code.gueltig_ab > now() then
      raise exception 'CODE_NOCH_NICHT';
    end if;
    if v_code.gueltig_bis is not null and v_code.gueltig_bis < now() then
      raise exception 'CODE_ABGELAUFEN';
    end if;
    if v_code.event_id is not null and v_code.event_id <> p_event_id then
      raise exception 'CODE_ANDERES_EVENT';
    end if;
    if v_code.max_tickets is not null and v_code.eingeloest >= v_code.max_tickets then
      raise exception 'CODE_AUFGEBRAUCHT';
    end if;

    if v_code.einmal_pro_person and exists (
      select 1 from bestellungen b
       where b.rabattcode_id = v_code.id
         and b.kunde_id = v_kunde_id
         and b.id <> v_bestellung_id
         and (b.status = 'bezahlt' or (b.status = 'offen' and b.vorkasse))
    ) then
      raise exception 'CODE_SCHON_GENUTZT';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'phase_id', phase_id, 'menge', menge, 'einzelpreis_cent', einzelpreis_cent)),
             '[]'::jsonb)
      into v_posten
      from bestellpositionen
     where bestellung_id = v_bestellung_id;

    select r.rabatt, r.anzahl into v_code_rabatt, v_code_tickets
      from code_rabatt(v_code, v_posten) r;

    if v_code_tickets = 0 then
      raise exception 'CODE_PASST_NICHT';
    end if;

    v_code_rabatt := rabatt_ohne_kleinstbetrag(v_code_rabatt, v_summe + v_gebuehr);

    update rabattcodes
       set eingeloest = eingeloest + v_code_tickets
     where id = v_code.id;
  end if;

  update bestellungen
     set summe_cent       = v_summe,
         gebuehr_cent     = v_gebuehr,
         gesamt_cent      = v_summe + v_gebuehr - v_code_rabatt,
         rabattcode_id    = case when v_code_tickets > 0 then v_code.id end,
         rabattcode       = case when v_code_tickets > 0 then v_code.code end,
         code_rabatt_cent = v_code_rabatt,
         code_tickets     = v_code_tickets,
         einladung_id     = v_einladung_id
   where id = v_bestellung_id;

  return v_bestellung_id;
end;
$$;

-- ---------- Kunde für die Tür ----------
-- Ein Gast an der Abendkasse gibt selten eine Adresse an. Statt für jeden
-- Barverkauf eine leere Kundenzeile anzulegen, bekommt jedes Event genau
-- eine: "Abendkasse". Wer doch eine Adresse nennt, wird normaler Kunde.
create or replace function abendkasse_kunde(p_event_id uuid, p_email text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_mail citext := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if v_mail is not null then
    insert into kunden (email, vorname) values (v_mail, 'Abendkasse')
    on conflict (email) do update set vorname = coalesce(kunden.vorname, 'Abendkasse')
    returning id into v_id;
    return v_id;
  end if;

  select id into v_id
    from kunden
   where email is null and vorname = 'Abendkasse' and nachname = p_event_id::text;
  if v_id is not null then
    return v_id;
  end if;

  insert into kunden (vorname, nachname) values ('Abendkasse', p_event_id::text)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- Verkauf an der Tür ----------
-- p_zahlung: 'bar'  → sofort bezahlt, Tickets entstehen sofort
--            'qr'   → Bestellung bleibt offen, der Gast zahlt mit seinem
--                     Handy; Tickets entstehen beim Zahlungseingang
-- p_einlassen: Tickets sofort entwerten (Bargeld: die Person steht vor dir)
-- Antwortet immer mit jsonb; wirft nur bei echten Fehlern.
create or replace function verkaufe_abendkasse(
  p_event_id  uuid,
  p_phase_id  uuid,
  p_menge     int,
  p_zahlung   text default 'bar',
  p_einlassen boolean default true,
  p_email     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event      events%rowtype;
  v_phase      phasen%rowtype;
  v_kunde      uuid;
  v_bestellung bestellungen%rowtype;
  v_summe      int;
  v_gebuehr    int;
  v_i          int;
  v_codes      text[] := '{}';
  v_code       text;
begin
  if not ist_mitarbeiter('kasse') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if p_menge is null or p_menge < 1 or p_menge > 20 then
    return jsonb_build_object('ergebnis', 'menge');
  end if;
  if p_zahlung not in ('bar', 'qr') then
    return jsonb_build_object('ergebnis', 'zahlungsart');
  end if;

  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'veroeffentlicht' then
    return jsonb_build_object('ergebnis', 'event_zu');
  end if;

  -- Dieselbe Sperre wie im Online-Verkauf: Zwischen Zählen und Buchen
  -- kommt niemand dazwischen, auch nicht der Webshop.
  select * into v_phase from phasen
   where id = p_phase_id and event_id = p_event_id and abendkasse
   for update;
  if not found then
    return jsonb_build_object('ergebnis', 'phase_unbekannt');
  end if;
  if not v_phase.aktiv then
    return jsonb_build_object('ergebnis', 'phase_zu');
  end if;
  if v_phase.kontingent is not null and v_phase.verkauft + p_menge > v_phase.kontingent then
    return jsonb_build_object('ergebnis', 'ausverkauft',
      'rest', greatest(v_phase.kontingent - v_phase.verkauft, 0));
  end if;

  v_summe   := v_phase.preis_cent * p_menge;
  v_gebuehr := v_phase.gebuehr_cent * p_menge;
  v_kunde   := abendkasse_kunde(p_event_id, p_email);

  update phasen set verkauft = verkauft + p_menge where id = v_phase.id;

  insert into bestellungen
    (nummer, event_id, kunde_id, status, summe_cent, gebuehr_cent, gesamt_cent,
     zahlungsart, zahlung_ref, abendkasse, reserviert_bis, bezahlt_am)
  values
    (neue_bestellnummer(), p_event_id, v_kunde,
     case when p_zahlung = 'bar' then 'bezahlt' else 'offen' end,
     v_summe, v_gebuehr, v_summe + v_gebuehr,
     case when p_zahlung = 'bar' then 'abendkasse'::zahlungsart end,
     case when p_zahlung = 'bar' then 'bar' end,
     true,
     case when p_zahlung = 'qr' then now() + interval '20 minutes' end,
     case when p_zahlung = 'bar' then now() end)
  returning * into v_bestellung;

  insert into bestellpositionen
    (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
  values
    (v_bestellung.id, v_phase.id, v_phase.name, p_menge, v_phase.preis_cent, v_phase.gebuehr_cent);

  if p_zahlung = 'bar' then
    for v_i in 1..p_menge loop
      v_code := neuer_ticketcode();
      insert into tickets (bestellung_id, event_id, phase_id, phase_name, art, code,
                           status, entwertet_am, entwertet_von)
      values (v_bestellung.id, p_event_id, v_phase.id, v_phase.name,
              (select art from phasen where id = v_phase.id), v_code,
              case when p_einlassen then 'entwertet' else 'gueltig' end::ticket_status,
              case when p_einlassen then now() end,
              case when p_einlassen then auth.uid() end);
      v_codes := v_codes || v_code;
    end loop;
  end if;

  return jsonb_build_object(
    'ergebnis', 'ok',
    'bestellung_id', v_bestellung.id,
    'nummer', v_bestellung.nummer,
    'zugangstoken', v_bestellung.zugangstoken,
    'gesamt_cent', v_bestellung.gesamt_cent,
    'bezahlt', p_zahlung = 'bar',
    'eingelassen', p_zahlung = 'bar' and p_einlassen,
    'codes', to_jsonb(v_codes)
  );
end;
$$;

-- ---------- Nach der QR-Zahlung ----------
-- Der Gast hat mit dem Handy bezahlt, der Webhook hat die Tickets erzeugt.
-- Hier werden sie eingelassen — dieselbe Wirkung wie ein Scan, nur ohne
-- Schlange. Mehrfach aufrufbar.
create or replace function abendkasse_einlassen(p_bestellung_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_anzahl     int;
begin
  if not ist_mitarbeiter('kasse') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_bestellung from bestellungen
   where id = p_bestellung_id and abendkasse;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_bestellung.status <> 'bezahlt' then
    return jsonb_build_object('ergebnis', 'nicht_bezahlt', 'status', v_bestellung.status);
  end if;

  update tickets
     set status = 'entwertet', entwertet_am = now(), entwertet_von = auth.uid()
   where bestellung_id = p_bestellung_id and status = 'gueltig';
  get diagnostics v_anzahl = row_count;

  return jsonb_build_object('ergebnis', 'ok', 'eingelassen', v_anzahl);
end;
$$;

-- ---------- Kassenbericht ----------
-- Was heute an der Tür eingenommen wurde, getrennt nach bar und QR. Für die
-- Abrechnung am Ende des Abends: Was in der Kasse liegen muss, steht unter
-- "bar".
create or replace function abendkasse_stand(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('kasse') then jsonb_build_object('ergebnis', 'keine_berechtigung')
    else (
      select jsonb_build_object(
        'ergebnis', 'ok',
        'tickets', coalesce(sum(t.anzahl), 0),
        'bar_cent', coalesce(sum(case when b.zahlungsart = 'abendkasse' then b.gesamt_cent else 0 end), 0),
        'qr_cent', coalesce(sum(case when b.zahlungsart <> 'abendkasse' then b.gesamt_cent else 0 end), 0),
        'offen', (select count(*) from bestellungen o
                   where o.event_id = p_event_id and o.abendkasse and o.status = 'offen'
                     and (o.reserviert_bis is null or o.reserviert_bis > now()))
      )
      from bestellungen b
      left join lateral (
        select sum(p.menge) as anzahl from bestellpositionen p where p.bestellung_id = b.id
      ) t on true
      where b.event_id = p_event_id and b.abendkasse and b.status = 'bezahlt'
    )
  end;
$$;

-- ---------- Rechte (siehe 0012) ----------
revoke execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text, text)
  from public, anon, authenticated;
grant execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text, text)
  to service_role;

revoke execute on function abendkasse_kunde(uuid, text) from public, anon, authenticated;
-- Die drei laufen über die Sitzung der Kasse und prüfen die Rolle selbst.
revoke execute on function verkaufe_abendkasse(uuid, uuid, int, text, boolean, text) from public, anon;
revoke execute on function abendkasse_einlassen(uuid) from public, anon;
revoke execute on function abendkasse_stand(uuid) from public, anon;
grant execute on function verkaufe_abendkasse(uuid, uuid, int, text, boolean, text)
  to authenticated, service_role;
grant execute on function abendkasse_einlassen(uuid) to authenticated, service_role;
grant execute on function abendkasse_stand(uuid) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  f text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'phasen' and column_name = 'abendkasse') then
    raise exception 'phasen.abendkasse fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'bestellungen' and column_name = 'abendkasse') then
    raise exception 'bestellungen.abendkasse fehlt';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reserviere') <> 1 then
    raise exception 'reserviere() gibt es nicht genau einmal';
  end if;
  if not exists (select 1 from pg_proc where proname = 'reserviere'
                  and prosrc like '%PHASE_NUR_ABENDKASSE%'
                  and prosrc like '%not vor.abendkasse%'
                  and prosrc like '%PRESALE_ZUGANG_FEHLT%'
                  and prosrc like '%CODE_SCHON_GENUTZT%'
                  and prosrc like '%FASTLANE_AUSVERKAUFT%') then
    raise exception 'reserviere() hat Abendkasse, Presale, Code oder Fast Lane verloren';
  end if;

  -- Ohne Rolle geht an der Tür nichts.
  if verkaufe_abendkasse(gen_random_uuid(), gen_random_uuid(), 1) ->> 'ergebnis'
       <> 'keine_berechtigung'
     or abendkasse_einlassen(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or abendkasse_stand(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'Abendkasse ohne Rolle offen';
  end if;

  foreach f in array array[
    'public.verkaufe_abendkasse(uuid, uuid, int, text, boolean, text)',
    'public.abendkasse_einlassen(uuid)',
    'public.abendkasse_stand(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% ist ohne Anmeldung aufrufbar', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist für die Kasse nicht aufrufbar', f;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.abendkasse_kunde(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.abendkasse_kunde(uuid, text)', 'execute') then
    raise exception 'abendkasse_kunde ist offen';
  end if;
end $$;
