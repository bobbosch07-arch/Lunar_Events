-- ============================================================
-- Lunar Events — Reservierung, Tickets, Entwertung
--
-- Der Kern: zwei Leute klicken gleichzeitig auf das letzte Ticket.
-- Wer im Anwendungscode erst zaehlt und dann bucht, verkauft eines zu
-- viel — zwischen Zaehlen und Buchen liegt immer eine Luecke. Deshalb
-- passiert beides hier, in einer Transaktion, mit gesperrter Zeile.
-- ============================================================

begin;

-- ---------- Bestellnummer ----------
-- Menschenlesbar, weil sie am Telefon vorgelesen und auf Tickets gedruckt
-- wird: LUN-1042-7K
create or replace function neue_bestellnummer()
returns text
language plpgsql
as $$
declare
  lauf bigint;
begin
  lauf := nextval('bestellnummer_seq');
  return 'LUN-' || lauf::text || '-' ||
         upper(substr(encode(gen_random_bytes(2), 'hex'), 1, 2));
end;
$$;

-- ---------- Ticketcode ----------
-- Der Wert, der im QR steht. 20 Zeichen aus einem Alphabet ohne die
-- Verwechslungskandidaten 0/O und 1/I/l — falls jemand ihn abtippen muss.
create or replace function neuer_ticketcode()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  ergebnis text := '';
  i int;
begin
  for i in 1..20 loop
    ergebnis := ergebnis ||
      substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return ergebnis;
end;
$$;

-- ---------- Reservierung ----------
-- Nimmt eine Auswahl entgegen ([{phase_id, menge}, …]), prueft jede Phase
-- unter Sperre und legt die Bestellung an. Gibt die Bestell-ID zurueck
-- oder bricht mit einer sprechenden Meldung ab.
create or replace function reserviere(
  p_event_id   uuid,
  p_auswahl    jsonb,
  p_email      text,
  p_vorname    text default null,
  p_nachname   text default null,
  p_telefon    text default null,
  p_minuten    int default 15
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
  v_event         events%rowtype;
begin
  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'veroeffentlicht' then
    raise exception 'EVENT_NICHT_VERFUEGBAR';
  end if;
  if v_event.beginn < now() then
    raise exception 'EVENT_VORBEI';
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
  end loop;

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
-- Erst hier entstehen Tickets. Vorher gibt es nur eine Reservierung —
-- ein Ticket, das nie bezahlt wurde, soll nie existiert haben.
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
-- Gibt Kontingente zurueck, die nie bezahlt wurden. Laeuft als geplanter
-- Auftrag; bis dahin ruft die Anwendung sie beim Laden eines Events auf.
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

    update bestellungen set status = 'abgelaufen', reserviert_bis = null
     where id = v_bestellung.id;
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end;
$$;

-- ---------- Entwerten ----------
-- Der Scanner am Einlass ruft das. Antwortet immer mit einem Ergebnis,
-- nie mit einem Fehler: am Eingang steht jemand und wartet, da hilft eine
-- Ausnahme niemandem — die Person am Gerät muss sofort sehen, was los ist.
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
    'gast', v_ticket.gast_name,
    'platz', v_ticket.platz);
end;
$$;

commit;

-- ---------- Selbstpruefung ----------
do $$
declare
  fehlt text;
begin
  select string_agg(f, ', ')
    into fehlt
    from unnest(array[
      'neue_bestellnummer','neuer_ticketcode','reserviere',
      'bestaetige_zahlung','raeume_reservierungen_auf','entwerte_ticket'
    ]) as f
   where to_regprocedure('public.' || f || '()') is null
     and not exists (
       select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = f
     );

  if fehlt is not null then
    raise exception 'Funktionen fehlen: %', fehlt;
  end if;
end $$;
