-- ============================================================
-- Lunar Events — Rabattcodes
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Ein Code wirkt nur auf den Ticketpreis. Servicegebühr und Fast Lane
--     bleiben voll — die Gebühr deckt Kosten, die bei jedem Ticket
--     anfallen, auch bei einem geschenkten.
--   * Prozent oder fester Betrag, beides je Ticket. Ein Betrag über dem
--     Ticketpreis macht das Ticket kostenlos, nie negativ.
--   * Grenzen, alle freiwillig: Event, Phasen, Zeitraum, Anzahl
--     rabattierter Tickets, einmal je Person (= E-Mail-Adresse).
--   * Die Obergrenze zählt rabattierte Tickets, nicht Bestellungen. Reicht
--     der Rest nicht für die ganze Bestellung, bekommen so viele Tickets den
--     Rabatt, wie übrig sind.
--
-- Die Einlösungen werden behandelt wie ein Kontingent: reserviere() zählt
-- sie unter Sperre hoch, raeume_reservierungen_auf() gibt sie beim Verfall
-- zurück, und die Obergrenze steht zusätzlich als Regel in der Tabelle.
-- Wer das anfasst, denkt an alle drei Stellen — und an waehle_vorkasse(),
-- die den Gesamtbetrag neu setzt.
--
-- Gerechnet wird an genau einer Stelle, code_rabatt(). Die Vorschau in der
-- Kasse (pruefe_rabattcode) und die verbindliche Reservierung rufen beide
-- diese Funktion, damit Anzeige und Abbuchung nicht auseinanderlaufen.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'rabatt_art') then
    create type rabatt_art as enum ('prozent', 'betrag');
  end if;
end $$;

-- ---------- Tabelle ----------
create table if not exists rabattcodes (
  id                uuid primary key default gen_random_uuid(),
  -- Immer in Großbuchstaben gespeichert; der Gast darf tippen, wie er will.
  code              text not null,
  art               rabatt_art not null,
  -- Prozent: 1–100. Betrag: Cent je Ticket.
  wert              int not null,
  -- null = gilt für alle Events
  event_id          uuid references events (id) on delete cascade,
  -- null = alle Phasen. Nur zusammen mit einem Event sinnvoll, weil
  -- Phasen zu genau einem Event gehören.
  phasen_ids        uuid[],
  gueltig_ab        timestamptz,
  gueltig_bis       timestamptz,
  -- Höchstzahl rabattierter Tickets, null = unbegrenzt
  max_tickets       int,
  -- Rabattierte Tickets in offenen und bezahlten Bestellungen
  eingeloest        int not null default 0,
  einmal_pro_person boolean not null default false,
  aktiv             boolean not null default true,
  -- Nur fürs Team: wofür der Code gedacht ist ("Insta-Story 20.09.")
  notiz             text,
  erstellt_am       timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rabattcodes_code_form') then
    alter table rabattcodes add constraint rabattcodes_code_form
      check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rabattcodes_wert') then
    alter table rabattcodes add constraint rabattcodes_wert
      check (wert > 0 and (art <> 'prozent' or wert <= 100));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rabattcodes_phasen') then
    alter table rabattcodes add constraint rabattcodes_phasen
      check (phasen_ids is null or event_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rabattcodes_zeitraum') then
    alter table rabattcodes add constraint rabattcodes_zeitraum
      check (gueltig_ab is null or gueltig_bis is null or gueltig_ab < gueltig_bis);
  end if;
  -- Die letzte Stelle, an der ein Überziehen noch jemand merkt.
  if not exists (select 1 from pg_constraint where conname = 'rabattcodes_grenze') then
    alter table rabattcodes add constraint rabattcodes_grenze
      check (eingeloest >= 0
             and (max_tickets is null or (max_tickets > 0 and eingeloest <= max_tickets)));
  end if;
end $$;

create unique index if not exists rabattcodes_code_idx on rabattcodes (code);

-- ---------- Bestellungen ----------
-- Code und Betrag werden kopiert: Die Bestellung muss stimmen, auch wenn
-- der Code später geändert oder gelöscht wird. rabatt_cent bleibt der
-- Vorkasse-Rabatt (0013); gesamt = summe + gebühr − rabatt − code_rabatt.
alter table bestellungen
  add column if not exists rabattcode_id    uuid references rabattcodes (id) on delete set null,
  add column if not exists rabattcode       text,
  add column if not exists code_rabatt_cent int not null default 0 check (code_rabatt_cent >= 0),
  -- Wie viele Tickets den Rabatt bekommen — das wird beim Verfall zurückgegeben.
  add column if not exists code_tickets     int not null default 0 check (code_tickets >= 0);

create index if not exists bestellungen_rabattcode_idx
  on bestellungen (rabattcode_id) where rabattcode_id is not null;

-- ---------- Zugriffsregeln ----------
-- Lesen darf das Team, anlegen und ändern nur ein Admin: Ein Code ist
-- bares Geld.
alter table rabattcodes enable row level security;

drop policy if exists rabattcodes_lesen on rabattcodes;
create policy rabattcodes_lesen on rabattcodes
  for select using (ist_mitarbeiter('team'));

drop policy if exists rabattcodes_pflegen on rabattcodes;
create policy rabattcodes_pflegen on rabattcodes
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

-- ---------- Rechnung ----------
-- p_posten: [{phase_id, menge, einzelpreis_cent}]. Teure Tickets zuerst —
-- reicht die Obergrenze nicht für alle, bekommt der Gast den größeren
-- Nachlass. Meist ist es ohnehin nur eine Phase, weil nur die aktuelle
-- kaufbar ist.
create or replace function code_rabatt(p_code rabattcodes, p_posten jsonb)
returns table (rabatt int, anzahl int)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_rest   int := case when p_code.max_tickets is null then null
                       else greatest(p_code.max_tickets - p_code.eingeloest, 0) end;
  v_posten record;
  v_n      int;
  v_je     int;
begin
  rabatt := 0;
  anzahl := 0;

  for v_posten in
    select (e ->> 'phase_id')::uuid          as phase_id,
           (e ->> 'menge')::int              as menge,
           (e ->> 'einzelpreis_cent')::int   as preis
      from jsonb_array_elements(coalesce(p_posten, '[]'::jsonb)) e
     order by (e ->> 'einzelpreis_cent')::int desc
  loop
    continue when v_posten.menge is null or v_posten.menge <= 0 or v_posten.preis <= 0;
    continue when p_code.phasen_ids is not null
              and not (v_posten.phase_id = any (p_code.phasen_ids));

    v_n := case when v_rest is null then v_posten.menge
                else least(v_posten.menge, v_rest - anzahl) end;
    exit when v_n <= 0;

    v_je := case p_code.art
              when 'prozent' then round(v_posten.preis * p_code.wert / 100.0)::int
              else least(p_code.wert, v_posten.preis)
            end;

    rabatt := rabatt + v_je * v_n;
    anzahl := anzahl + v_n;
  end loop;

  return next;
end;
$$;

-- Stripe bucht unter 50 Cent nicht ab. Bliebe durch einen Code ein
-- Restbetrag darunter, wird er mit erlassen — sonst hinge der Gast in einer
-- Kasse fest, die nicht bezahlt werden kann. Mehr zu verlangen, als der
-- Code verspricht, kommt nicht in Frage; weniger ist das kleinere Übel.
create or replace function rabatt_ohne_kleinstbetrag(p_rabatt int, p_gesamt int)
returns int
language sql
immutable
as $$
  select case
           when p_rabatt > 0 and p_gesamt - p_rabatt between 1 and 49 then p_gesamt
           else p_rabatt
         end;
$$;

-- ---------- Vorschau für die Kasse ----------
-- Antwortet immer mit einem Ergebnis statt einer Ausnahme, wie
-- entwerte_ticket(): Die Kasse muss dem Gast sagen können, was los ist.
-- "Einmal je Person" lässt sich hier noch nicht prüfen — die E-Mail-Adresse
-- kommt erst in Schritt 2. Das erledigt reserviere().
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
  -- Ein pausierter Code verhält sich nach außen wie ein unbekannter.
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

  -- Preise aus der Datenbank, nie aus dem Browser.
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
    'art', v_code.art,
    'wert', v_code.wert,
    'rabatt_cent', rabatt_ohne_kleinstbetrag(v_rabatt, v_summe + v_gebuehr),
    'tickets', v_anzahl,
    'tickets_gesamt', v_alle
  );
end;
$$;

-- ---------- Reservierung ----------
-- Neuer Parameter p_code. Die alte Fassung wird entfernt, sonst gäbe es
-- zwei Funktionen gleichen Namens und der Aufruf wäre mehrdeutig.
drop function if exists reserviere(uuid, jsonb, text, text, text, text, int, int);

create or replace function reserviere(
  p_event_id   uuid,
  p_auswahl    jsonb,
  p_email      text,
  p_vorname    text default null,
  p_nachname   text default null,
  p_telefon    text default null,
  p_minuten    int default 15,
  p_fastlane   int default 0,
  p_code       text default null
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

  -- ---------- Fast Lane (0011) ----------
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

  -- ---------- Rabattcode (neu in 0016) ----------
  if v_code_text <> '' then
    -- Gesperrt wie ein Kontingent: Zwei Gäste greifen sonst gleichzeitig
    -- nach der letzten Einlösung.
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

    -- Einmal je Person heißt: je E-Mail-Adresse. Gezählt werden bezahlte
    -- Bestellungen und Überweisungen, die noch ausstehen. Eine liegen
    -- gelassene Kartenreservierung zählt nicht — sonst sperrte sich jeder
    -- selbst aus, der in der Kasse einmal zurückgeht und neu anfängt.
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
         code_tickets     = v_code_tickets
   where id = v_bestellung_id;

  return v_bestellung_id;
end;
$$;

-- ---------- Vorkasse ----------
-- Unverändert bis auf den Betrag: Der Code-Rabatt bleibt beim Wechsel zur
-- Überweisung erhalten. Vorher setzte die Funktion gesamt = summe und hätte
-- ihn damit still wieder aufgeschlagen.
create or replace function waehle_vorkasse(
  p_bestellung_id uuid,
  p_frist_tage    int default 3,
  p_mindest_tage  int default 5
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_beginn     timestamptz;
  v_bis        timestamptz;
begin
  select * into v_bestellung
    from bestellungen where id = p_bestellung_id for update;

  if not found then
    raise exception 'BESTELLUNG_UNBEKANNT';
  end if;
  if v_bestellung.status <> 'offen' then
    raise exception 'BESTELLUNG_NICHT_OFFEN:%', v_bestellung.status;
  end if;
  if v_bestellung.reserviert_bis is not null and v_bestellung.reserviert_bis < now() then
    raise exception 'RESERVIERUNG_ABGELAUFEN';
  end if;
  if v_bestellung.vorkasse then
    return v_bestellung.reserviert_bis;
  end if;

  select beginn into v_beginn from events where id = v_bestellung.event_id;

  -- Eine Überweisung braucht ein bis zwei Werktage, dazu kommt die
  -- Kontrolle durchs Team. Zu kurz vor dem Event geht das nicht auf.
  if v_beginn < now() + make_interval(days => p_mindest_tage) then
    raise exception 'VORKASSE_ZU_KURZFRISTIG';
  end if;

  -- Die Frist endet spätestens zwei Tage vor Beginn — sonst hielte eine
  -- nie bezahlte Reservierung Plätze bis in den Abend hinein.
  v_bis := least(now() + make_interval(days => p_frist_tage), v_beginn - interval '2 days');

  -- Rabatt = Servicegebühren. gesamt = summe + gebühr − rabatt − code_rabatt.
  update bestellungen
     set vorkasse       = true,
         rabatt_cent    = v_bestellung.gebuehr_cent,
         gesamt_cent    = greatest(v_bestellung.summe_cent - v_bestellung.code_rabatt_cent, 0),
         reserviert_bis = v_bis
   where id = p_bestellung_id;

  return v_bis;
end;
$$;

-- ---------- Abgelaufene Reservierungen ----------
-- Gibt jetzt auch Einlösungen zurück. Ohne das wäre ein Code mit
-- Obergrenze nach ein paar abgebrochenen Käufen aufgebraucht, ohne dass
-- jemand gezahlt hat.
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

    if v_bestellung.rabattcode_id is not null and v_bestellung.code_tickets > 0 then
      update rabattcodes
         set eingeloest = greatest(eingeloest - v_bestellung.code_tickets, 0)
       where id = v_bestellung.rabattcode_id;
    end if;

    update bestellungen set status = 'abgelaufen', reserviert_bis = null
     where id = v_bestellung.id;
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end;
$$;

-- ---------- Rechte (siehe 0012) ----------
-- drop + create hat die Rechte von reserviere() zurückgesetzt.
revoke execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text)
  from public, anon, authenticated;
grant execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text)
  to service_role;

-- Nur der Server fragt, ob ein Code gilt. Offen über die Schnittstelle
-- ließen sich Codes sonst in Serie durchprobieren.
revoke execute on function pruefe_rabattcode(text, uuid, jsonb, int)
  from public, anon, authenticated;
grant execute on function pruefe_rabattcode(text, uuid, jsonb, int) to service_role;

-- Reine Rechenhilfen. Sie laufen innerhalb der Funktionen oben mit deren
-- Rechten und brauchen nach außen niemand.
revoke execute on function code_rabatt(rabattcodes, jsonb) from public, anon, authenticated;
revoke execute on function rabatt_ohne_kleinstbetrag(int, int) from public, anon, authenticated;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_code   rabattcodes;
  v_posten jsonb := '[{"phase_id":"00000000-0000-0000-0000-000000000001","menge":4,"einzelpreis_cent":1000},
                      {"phase_id":"00000000-0000-0000-0000-000000000002","menge":2,"einzelpreis_cent":300}]';
  v_r      record;
begin
  -- 20 % auf alles: 4 × 200 + 2 × 60
  v_code := jsonb_populate_record(null::rabattcodes,
    '{"code":"PRUEF","art":"prozent","wert":20,"eingeloest":0}');
  select * into v_r from code_rabatt(v_code, v_posten);
  if v_r.rabatt <> 920 or v_r.anzahl <> 6 then
    raise exception 'Prozent falsch gerechnet: % / %', v_r.rabatt, v_r.anzahl;
  end if;

  -- 5 € je Ticket, aber nie mehr als der Preis: 4 × 500 + 2 × 300
  v_code := jsonb_populate_record(null::rabattcodes,
    '{"code":"PRUEF","art":"betrag","wert":500,"eingeloest":0}');
  select * into v_r from code_rabatt(v_code, v_posten);
  if v_r.rabatt <> 2600 or v_r.anzahl <> 6 then
    raise exception 'Betrag falsch gerechnet: % / %', v_r.rabatt, v_r.anzahl;
  end if;

  -- Obergrenze 5, schon 2 eingelöst: nur 3 Tickets, die teuren zuerst
  v_code := jsonb_populate_record(null::rabattcodes,
    '{"code":"PRUEF","art":"prozent","wert":50,"max_tickets":5,"eingeloest":2}');
  select * into v_r from code_rabatt(v_code, v_posten);
  if v_r.rabatt <> 1500 or v_r.anzahl <> 3 then
    raise exception 'Obergrenze falsch gerechnet: % / %', v_r.rabatt, v_r.anzahl;
  end if;

  -- Nur Phase 2
  v_code := jsonb_populate_record(null::rabattcodes,
    '{"code":"PRUEF","art":"prozent","wert":100,"eingeloest":0,
      "phasen_ids":["00000000-0000-0000-0000-000000000002"]}');
  select * into v_r from code_rabatt(v_code, v_posten);
  if v_r.rabatt <> 600 or v_r.anzahl <> 2 then
    raise exception 'Phasengrenze falsch gerechnet: % / %', v_r.rabatt, v_r.anzahl;
  end if;

  if rabatt_ohne_kleinstbetrag(38, 40) <> 40 or rabatt_ohne_kleinstbetrag(10, 100) <> 10
     or rabatt_ohne_kleinstbetrag(0, 30) <> 0 or rabatt_ohne_kleinstbetrag(100, 100) <> 100 then
    raise exception 'Kleinstbetrag falsch behandelt';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reserviere') <> 1 then
    raise exception 'reserviere() gibt es nicht genau einmal';
  end if;
  if not exists (select 1 from pg_proc where proname = 'reserviere'
                  and prosrc like '%CODE_SCHON_GENUTZT%'
                  and prosrc like '%FASTLANE_AUSVERKAUFT%'
                  and prosrc like '%vor.position < v_phase.position%') then
    raise exception 'reserviere() hat Code, Fast Lane oder Phasenfolge verloren';
  end if;
  if not exists (select 1 from pg_proc where proname = 'raeume_reservierungen_auf'
                  and prosrc like '%rabattcodes%' and prosrc like '%fastlane_verkauft%') then
    raise exception 'raeume_reservierungen_auf() gibt Einlösungen oder Fast Lane nicht zurück';
  end if;
  if not exists (select 1 from pg_proc where proname = 'waehle_vorkasse'
                  and prosrc like '%code_rabatt_cent%') then
    raise exception 'waehle_vorkasse() kennt den Code-Rabatt nicht';
  end if;

  if has_function_privilege('anon', 'public.reserviere(uuid, jsonb, text, text, text, text, int, int, text)', 'execute')
     or has_function_privilege('authenticated', 'public.reserviere(uuid, jsonb, text, text, text, text, int, int, text)', 'execute') then
    raise exception 'reserviere ist öffentlich aufrufbar';
  end if;
  if not has_function_privilege('service_role', 'public.reserviere(uuid, jsonb, text, text, text, text, int, int, text)', 'execute') then
    raise exception 'Server kann reserviere nicht aufrufen';
  end if;
  if has_function_privilege('anon', 'public.pruefe_rabattcode(text, uuid, jsonb, int)', 'execute')
     or has_function_privilege('authenticated', 'public.pruefe_rabattcode(text, uuid, jsonb, int)', 'execute') then
    raise exception 'pruefe_rabattcode ist öffentlich aufrufbar';
  end if;
  if not has_function_privilege('service_role', 'public.pruefe_rabattcode(text, uuid, jsonb, int)', 'execute') then
    raise exception 'Server kann pruefe_rabattcode nicht aufrufen';
  end if;
  if not exists (select 1 from pg_class where relname = 'rabattcodes' and relrowsecurity) then
    raise exception 'rabattcodes ohne Zugriffsregeln';
  end if;
end $$;
