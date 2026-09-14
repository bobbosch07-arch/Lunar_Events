-- ============================================================
-- Lunar Events — Fast Lane
--
-- Ein Upgrade, kein Ticket: Wer Fast Lane dazubucht, muss am Einlass
-- nicht in der normalen Schlange stehen. Deshalb hängt es an den
-- Tickets einer Bestellung (tickets.fastlane) und nicht als eigene Phase
-- daneben — sonst bekäme jeder Käufer einen zweiten QR-Code, der allein
-- nichts öffnet.
--
-- Das Kontingent liegt am Event, weil der Engpass die Fast-Lane-Spur am
-- Eingang ist, nicht eine Ticketphase. Es wird genauso behandelt wie ein
-- Phasenkontingent: unter Sperre gebucht, bei Ablauf zurückgegeben, und
-- die Obergrenze steht zusätzlich als Regel in der Tabelle.
-- ============================================================

begin;

-- ---------- Spalten ----------
alter table events
  add column if not exists fastlane_aktiv        boolean not null default false,
  add column if not exists fastlane_preis_cent   int     not null default 0,
  -- null = unbegrenzt
  add column if not exists fastlane_kontingent   int,
  add column if not exists fastlane_verkauft     int     not null default 0,
  add column if not exists fastlane_beschreibung text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_fastlane_gueltig') then
    alter table events add constraint events_fastlane_gueltig check (
      fastlane_preis_cent >= 0
      and fastlane_verkauft >= 0
      and (fastlane_kontingent is null
           or (fastlane_kontingent >= 0 and fastlane_verkauft <= fastlane_kontingent))
    );
  end if;
end $$;

-- Menge und Preis werden in die Bestellung kopiert — wie bei den
-- Positionen: die Bestellung muss stimmen, auch wenn der Preis am Event
-- später geändert wird.
alter table bestellungen
  add column if not exists fastlane_menge      int not null default 0 check (fastlane_menge >= 0),
  add column if not exists fastlane_preis_cent int not null default 0 check (fastlane_preis_cent >= 0);

alter table tickets
  add column if not exists fastlane boolean not null default false;

-- ---------- Reservierung ----------
-- Neuer Parameter p_fastlane: für wie viele Tickets der Bestellung.
-- Die alte Fassung wird entfernt, sonst gäbe es zwei Funktionen gleichen
-- Namens und der Aufruf wäre mehrdeutig.
drop function if exists reserviere(uuid, jsonb, text, text, text, text, int);

create or replace function reserviere(
  p_event_id   uuid,
  p_auswahl    jsonb,
  p_email      text,
  p_vorname    text default null,
  p_nachname   text default null,
  p_telefon    text default null,
  p_minuten    int default 15,
  p_fastlane   int default 0
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

  -- Kunde anlegen oder wiederfinden
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

    -- Die Sperre ist der ganze Punkt: ab hier kann niemand sonst dieselbe
    -- Phase veraendern, bis diese Transaktion fertig ist.
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
    if not v_phase.aktiv
       or (v_phase.ab is not null and v_phase.ab > now())
       or (v_phase.bis is not null and v_phase.bis < now()) then
      raise exception 'PHASE_NICHT_KAUFBAR';
    end if;

    -- Seit 0010: Hat eine frühere Standardphase noch Tickets, ist diese
    -- hier noch nicht dran.
    if exists (
      select 1
        from phasen vor
       where vor.event_id = p_event_id
         and vor.art = 'standard'
         and vor.aktiv
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

  -- ---------- Fast Lane (neu in 0011) ----------
  if coalesce(p_fastlane, 0) > 0 then
    -- Dieselbe Sperre wie bei den Phasen, diesmal auf das Event: zwei
    -- Käufer greifen sonst gleichzeitig nach dem letzten Platz.
    select * into v_event from events where id = p_event_id for update;

    if not v_event.fastlane_aktiv then
      raise exception 'FASTLANE_NICHT_VERFUEGBAR';
    end if;
    -- Mehr Upgrades als Tickets ergäben Fast Lane ohne Person dazu.
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

  update bestellungen
     set summe_cent   = v_summe,
         gebuehr_cent = v_gebuehr,
         gesamt_cent  = v_summe + v_gebuehr
   where id = v_bestellung_id;

  return v_bestellung_id;
end;
$$;

-- ---------- Bezahlung bestaetigen ----------
-- Unverändert bis auf den Schluss: Die Fast-Lane-Menge wird auf die
-- ersten Tickets der Bestellung verteilt.
create or replace function bestaetige_zahlung(
  p_bestellung_id uuid,
  p_zahlungsart   zahlungsart,
  p_referenz      text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_position   bestellpositionen%rowtype;
  v_i          int;
  v_anzahl     int := 0;
begin
  select * into v_bestellung
    from bestellungen where id = p_bestellung_id for update;

  if not found then
    raise exception 'BESTELLUNG_UNBEKANNT';
  end if;

  -- Zahlungsanbieter melden denselben Vorgang gern mehrfach. Zweimal
  -- Tickets auszustellen waere schlimmer als eine verpasste Meldung.
  if v_bestellung.status = 'bezahlt' then
    return (select count(*)::int from tickets where bestellung_id = p_bestellung_id);
  end if;
  if v_bestellung.status <> 'offen' then
    raise exception 'BESTELLUNG_NICHT_OFFEN:%', v_bestellung.status;
  end if;

  for v_position in
    select * from bestellpositionen where bestellung_id = p_bestellung_id
  loop
    for v_i in 1..v_position.menge loop
      insert into tickets
        (bestellung_id, event_id, phase_id, phase_name, art, code, gast_name)
      values
        (p_bestellung_id, v_bestellung.event_id, v_position.phase_id,
         v_position.phase_name,
         (select art from phasen where id = v_position.phase_id),
         neuer_ticketcode(),
         null);
      v_anzahl := v_anzahl + 1;
    end loop;
  end loop;

  if v_bestellung.fastlane_menge > 0 then
    update tickets
       set fastlane = true
     where id in (
       select id from tickets
        where bestellung_id = p_bestellung_id
        order by erstellt_am, id
        limit v_bestellung.fastlane_menge
     );
  end if;

  update bestellungen
     set status         = 'bezahlt',
         zahlungsart    = p_zahlungsart,
         zahlung_ref    = p_referenz,
         bezahlt_am     = now(),
         reserviert_bis = null
   where id = p_bestellung_id;

  return v_anzahl;
end;
$$;

-- ---------- Abgelaufene Reservierungen ----------
-- Gibt jetzt auch Fast-Lane-Plätze zurück. Ohne das bliebe das
-- Kontingent nach jedem abgebrochenen Kauf dauerhaft belegt.
create or replace function raeume_reservierungen_auf()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_position   bestellpositionen%rowtype;
  v_anzahl     int := 0;
begin
  for v_bestellung in
    select * from bestellungen
     where status = 'offen'
       and reserviert_bis is not null
       and reserviert_bis < now()
     for update skip locked
  loop
    for v_position in
      select * from bestellpositionen where bestellung_id = v_bestellung.id
    loop
      update phasen
         set verkauft = greatest(verkauft - v_position.menge, 0)
       where id = v_position.phase_id;
    end loop;

    if v_bestellung.fastlane_menge > 0 then
      update events
         set fastlane_verkauft = greatest(fastlane_verkauft - v_bestellung.fastlane_menge, 0)
       where id = v_bestellung.event_id;
    end if;

    update bestellungen set status = 'abgelaufen', reserviert_bis = null
     where id = v_bestellung.id;
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end;
$$;

-- ---------- Entwerten ----------
-- Meldet zusätzlich, ob das Ticket Fast Lane hat — das Personal am
-- Eingang muss es sehen, bevor es jemanden an der Schlange vorbeiwinkt.
create or replace function entwerte_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket tickets%rowtype;
  v_event  events%rowtype;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_ticket from tickets where code = p_code for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  select * into v_event from events where id = v_ticket.event_id;

  if v_ticket.status = 'storniert' then
    return jsonb_build_object('ergebnis', 'storniert',
      'event', v_event.titel, 'typ', v_ticket.phase_name);
  end if;

  if v_ticket.status = 'entwertet' then
    return jsonb_build_object('ergebnis', 'schon_entwertet',
      'event', v_event.titel, 'typ', v_ticket.phase_name,
      'fastlane', v_ticket.fastlane,
      'zeitpunkt', v_ticket.entwertet_am);
  end if;

  update tickets
     set status        = 'entwertet',
         entwertet_am  = now(),
         entwertet_von = auth.uid()
   where id = v_ticket.id;

  return jsonb_build_object('ergebnis', 'gueltig',
    'event', v_event.titel,
    'typ', v_ticket.phase_name,
    'art', v_ticket.art,
    'fastlane', v_ticket.fastlane,
    'gast', v_ticket.gast_name,
    'platz', v_ticket.platz);
end;
$$;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reserviere') <> 1 then
    raise exception 'reserviere() gibt es nicht genau einmal';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reserviere'
       and p.prosrc like '%FASTLANE_AUSVERKAUFT%'
       and p.prosrc like '%vor.position < v_phase.position%'
  ) then
    raise exception 'reserviere() kennt Fast Lane oder die Phasenfolge nicht';
  end if;
  if not exists (select 1 from pg_proc where proname = 'raeume_reservierungen_auf'
                  and prosrc like '%fastlane_verkauft%') then
    raise exception 'raeume_reservierungen_auf() gibt Fast Lane nicht zurück';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'tickets' and column_name = 'fastlane') then
    raise exception 'tickets.fastlane fehlt';
  end if;
end $$;
