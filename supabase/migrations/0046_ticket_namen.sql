-- ============================================================
-- Lunar Events — Namen je Ticket (14.10.2026)
--
-- Am Einlass werden Ausweise kontrolliert. Wer mehrere Tickets kauft,
-- trägt deshalb für jedes Ticket den Namen der Person ein, die es nutzt
-- (Wunsch Bobbo). Entschieden am 14.10.:
--   - Ticket 1 ist in der Kasse mit dem Namen des Käufers vorausgefüllt.
--   - Ändern geht auf der Ticketseite bis Eventbeginn, für jeden mit dem
--     Ticketlink (wie das Ticket selbst).
--   - Der Scanner zeigt den Namen, auch ohne Netz.
--   - Bestand: Das erste Ticket bekommt den Namen des Käufers, die übrigen
--     fragt eine Mail aus dem Backoffice nach (namen_mail_am).
--
-- Tickets entstehen erst mit der Zahlung (bestaetige_zahlung). Bis dahin
-- liegen die Namen an der Bestellung (ticket_namen), in der Reihenfolge der
-- Kasse; bestaetige_zahlung gibt sie den Tickets in genau dieser Reihenfolge.
-- Der Funktionskörper von bestaetige_zahlung ist bis auf den Namen aus
-- 0033 übernommen, entwerte_ticket bis auf die Namensfelder aus 0011.
-- ============================================================

begin;

alter table bestellungen add column if not exists ticket_namen text[];
alter table bestellungen add column if not exists namen_mail_am timestamptz;

-- Ein Name auf einem Ticket: Vor- und Nachname, also mindestens zwei Teile,
-- 3 bis 80 Zeichen, bereits bereinigt (keine doppelten oder äußeren
-- Leerzeichen). Dieselbe Regel steht als istTicketname() in
-- src/lib/ticketname.ts; dort prüft sie zusätzlich auf Buchstaben.
create or replace function ist_ticketname(p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_name is not null
     and char_length(p_name) between 3 and 80
     and p_name ~ '^[^[:space:][:cntrl:]]+( [^[:space:][:cntrl:]]+)+$';
$$;

-- ---------- Zahlung bestätigen: Tickets mit Namen ----------
create or replace function bestaetige_zahlung(
  p_bestellung_id uuid,
  p_zahlungsart   zahlungsart,
  p_referenz      text,
  -- Was der Anbieter tatsaechlich abgebucht hat. Bleibt es null, wird
  -- nicht geprueft (Vorkasse, Freibestellung); die Zahlwege mit echtem
  -- Geld reichen den Betrag durch.
  p_erwartet_cent int default null
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
  v_kaeufer    text;
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

  -- Der gezahlte Betrag muss zur Bestellung passen. Sonst liesse sich
  -- eine billige Zahlung einer teuren Bestellung unterschieben (0033).
  if p_erwartet_cent is not null and p_erwartet_cent <> v_bestellung.gesamt_cent then
    raise exception 'BETRAG_STIMMT_NICHT:%:%', p_erwartet_cent, v_bestellung.gesamt_cent;
  end if;

  -- Namen (0046): in der Reihenfolge der Kasse. Fehlen sie ganz (in der
  -- Kasse vor 0046 reserviert, Überweisung von vorher), bekommt das erste
  -- Ticket den Namen des Käufers, wie ihn die Kasse heute vorausfüllt.
  -- An der Abendkasse steht die Person selbst da, dort gibt es keine Namen.
  if v_bestellung.ticket_namen is null and not v_bestellung.abendkasse then
    select nullif(btrim(concat_ws(' ', vorname, nachname)), '') into v_kaeufer
      from kunden where id = v_bestellung.kunde_id;
  end if;

  -- erstellt_am mit clock_timestamp(): now() ist die Zeit der Transaktion,
  -- alle Tickets hätten denselben Zeitstempel, und die Reihenfolge fiele auf
  -- die zufällige ID zurück (wie bei VIP in 0029). Mit Namen zählt sie:
  -- Ticket 1 ist das mit dem ersten Namen aus der Kasse.
  for v_position in
    select * from bestellpositionen where bestellung_id = p_bestellung_id
  loop
    for v_i in 1..v_position.menge loop
      insert into tickets
        (bestellung_id, event_id, phase_id, phase_name, art, code, gast_name, erstellt_am)
      values
        (p_bestellung_id, v_bestellung.event_id, v_position.phase_id,
         v_position.phase_name,
         (select art from phasen where id = v_position.phase_id),
         neuer_ticketcode(),
         coalesce(v_bestellung.ticket_namen[v_anzahl + 1],
                  case when v_anzahl = 0 then v_kaeufer end),
         clock_timestamp());
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

  -- Garderobenmarken (0027): eine je Stück, mit eigenem Code. Das "G-"
  -- kommt im Ticketalphabet nicht vor — so erkennt jeder Scanner, dass er
  -- eine Marke vor sich hat und kein Ticket.
  for v_i in 1..v_bestellung.garderobe_menge loop
    insert into garderobe_marken (bestellung_id, event_id, code)
    values (p_bestellung_id, v_bestellung.event_id, 'G-' || neuer_ticketcode());
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

-- ---------- Entwerten: Name für die Ausweiskontrolle ----------
-- Wie 0011, dazu der Name auch bei "schon drin" und die Meldung, dass bei
-- einem gekauften Ticket der Name fehlt (Bestand von vor 0046). Gästeliste,
-- VIP und Abendkasse haben keine Pflicht.
create or replace function entwerte_ticket(p_code text)
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

  select * into v_ticket from tickets where code = p_code for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  select * into v_event from events where id = v_ticket.event_id;

  v_name_fehlt := v_ticket.gast_name is null
    and v_ticket.bestellung_id is not null
    and not coalesce((select abendkasse from bestellungen where id = v_ticket.bestellung_id), false);

  if v_ticket.status = 'storniert' then
    return jsonb_build_object('ergebnis', 'storniert',
      'event', v_event.titel, 'typ', v_ticket.phase_name,
      'gast', v_ticket.gast_name);
  end if;

  if v_ticket.status = 'entwertet' then
    return jsonb_build_object('ergebnis', 'schon_entwertet',
      'event', v_event.titel, 'typ', v_ticket.phase_name,
      'fastlane', v_ticket.fastlane,
      'gast', v_ticket.gast_name,
      'name_fehlt', v_name_fehlt,
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
    'name_fehlt', v_name_fehlt,
    'platz', v_ticket.platz);
end;
$$;

-- ---------- Namen für den Scanner ohne Netz ----------
-- Schlüssel ist die Prüfsumme aus 0031, nicht der Code: Aus der Liste auf
-- dem Gerät lässt sich kein Ticket herstellen. Namen ohne Mailadressen,
-- wie die Namensliste der Gästeliste.
create or replace function einlass_namen(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(einlass_pruefsumme(t.code), t.gast_name), '{}'::jsonb)
    from tickets t
   where ist_mitarbeiter('einlass')
     and t.event_id = p_event_id
     and t.status = 'gueltig'
     and t.gast_name is not null;
$$;

revoke all on function einlass_namen(uuid) from public, anon;
grant execute on function einlass_namen(uuid) to authenticated, service_role;

-- ---------- Namen ändern über die Ticketseite ----------
-- Nachweis ist der Ticketlink (zugangstoken), wie für das Ticket selbst.
-- Bis Eventbeginn, nur gültige Tickets bezahlter Bestellungen. Antwortet
-- mit einer Kennung statt einer Ausnahme, die Seite übersetzt sie.
create or replace function aendere_ticketname(p_token text, p_code text, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_ticket tickets%rowtype;
  v_event  events%rowtype;
begin
  if not ist_ticketname(v_name) then
    return 'name';
  end if;

  select t.* into v_ticket
    from tickets t
    join bestellungen b on b.id = t.bestellung_id
   where b.zugangstoken = p_token
     and b.status = 'bezahlt'
     and t.code = upper(btrim(coalesce(p_code, '')))
     for update of t;
  if not found then
    return 'unbekannt';
  end if;

  select * into v_event from events where id = v_ticket.event_id;
  if v_ticket.status <> 'gueltig' or v_event.status = 'abgesagt' then
    return 'nicht_gueltig';
  end if;
  if now() >= v_event.beginn then
    return 'zu_spaet';
  end if;
  -- Ein Ticket gilt für eine Person: derselbe Name zweimal in einer
  -- Bestellung hieße, dass einer ohne passenden Ausweis kommt.
  if exists (select 1 from tickets
              where bestellung_id = v_ticket.bestellung_id
                and id <> v_ticket.id
                and status <> 'storniert'
                and lower(gast_name) = lower(v_name)) then
    return 'doppelt';
  end if;

  update tickets set gast_name = v_name where id = v_ticket.id;
  return 'ok';
end;
$$;

revoke all on function aendere_ticketname(text, text, text) from public, anon, authenticated;
grant execute on function aendere_ticketname(text, text, text) to service_role;

-- ---------- Bestand ----------
-- Bezahlte Bestellungen kommender Events ohne einen einzigen Namen: Das
-- erste nicht stornierte Ticket bekommt den Namen des Käufers. So zeigt der
-- Scanner bei den Einzeltickets nicht "kein Name", und bei mehreren Tickets
-- fehlen genau die, nach denen die Mail fragt.
update tickets t
   set gast_name = erstes.name
  from (
    select distinct on (t2.bestellung_id)
           t2.id,
           nullif(btrim(concat_ws(' ', k.vorname, k.nachname)), '') as name
      from tickets t2
      join bestellungen b on b.id = t2.bestellung_id
      join kunden k on k.id = b.kunde_id
      join events e on e.id = t2.event_id
     where b.status = 'bezahlt'
       and not b.abendkasse
       and e.beginn > now()
       and t2.status <> 'storniert'
       and not exists (select 1 from tickets t3
                        where t3.bestellung_id = b.id and t3.gast_name is not null)
     order by t2.bestellung_id, t2.erstellt_am, t2.id
  ) erstes
 where t.id = erstes.id
   and erstes.name is not null;

-- ---------- Selbstprüfung ----------
-- Vor dem commit: Scheitert sie, ist nichts geändert.
do $$
declare
  v_ev     uuid;
  v_ph     uuid;
  v_kunde  uuid;
  v_ort    uuid;
  v_b1     uuid;
  v_b2     uuid;
  v_token  text;
  v_code   text;
  v_namen  text[];
  v_name   text;
begin
  if not ist_ticketname('Anna Müller') or not ist_ticketname('Anna-Lena de la Cruz') then
    raise exception 'ist_ticketname lehnt gültige Namen ab';
  end if;
  if ist_ticketname('Anna') or ist_ticketname(' Anna Müller') or ist_ticketname('Anna  Müller')
     or ist_ticketname(null) or ist_ticketname(repeat('a', 41) || ' ' || repeat('b', 40)) then
    raise exception 'ist_ticketname nimmt ungültige Namen an';
  end if;

  select id into v_ort from orte limit 1;
  insert into kunden (email, vorname, nachname)
    values ('selbsttest-0046-' || gen_random_uuid() || '@example.invalid', 'Kara', 'Käufer')
    returning id into v_kunde;
  insert into events (slug, titel, kategorie, status, beginn, ort_id, veranstalter)
    values ('selbsttest-0046-' || gen_random_uuid(), 'SELBSTTEST', 'club',
            'entwurf', now() + interval '30 days', v_ort, 'Lunar Events')
    returning id into v_ev;
  insert into phasen (event_id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, aktiv, leistungen, position)
    values (v_ev, 'Test', 'standard', 2000, 0, 10, 0, true, '{}'::text[], 0)
    returning id into v_ph;

  -- Mit Namen aus der Kasse: in dieser Reihenfolge auf die Tickets.
  insert into bestellungen (nummer, event_id, kunde_id, status, summe_cent, gebuehr_cent, gesamt_cent,
                            reserviert_bis, ticket_namen)
    values (neue_bestellnummer(), v_ev, v_kunde, 'offen', 6000, 0, 6000, now() + interval '1 hour',
            array['Anna Eins', 'Ben Zwei', 'Cem Drei'])
    returning id, zugangstoken into v_b1, v_token;
  insert into bestellpositionen (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
    values (v_b1, v_ph, 'Test', 3, 2000, 0);
  perform bestaetige_zahlung(v_b1, 'stripe'::zahlungsart, 'ref', 6000);
  select array_agg(gast_name order by erstellt_am, id) into v_namen from tickets where bestellung_id = v_b1;
  if v_namen is distinct from array['Anna Eins', 'Ben Zwei', 'Cem Drei'] then
    raise exception 'Namen landen nicht in Reihenfolge auf den Tickets: %', v_namen;
  end if;

  -- Ohne Namen (vor 0046 reserviert): Ticket 1 trägt den Käufer.
  insert into bestellungen (nummer, event_id, kunde_id, status, summe_cent, gebuehr_cent, gesamt_cent, reserviert_bis)
    values (neue_bestellnummer(), v_ev, v_kunde, 'offen', 4000, 0, 4000, now() + interval '1 hour')
    returning id into v_b2;
  insert into bestellpositionen (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
    values (v_b2, v_ph, 'Test', 2, 2000, 0);
  perform bestaetige_zahlung(v_b2, 'stripe'::zahlungsart, 'ref', 4000);
  select array_agg(gast_name order by erstellt_am, id) into v_namen from tickets where bestellung_id = v_b2;
  if v_namen[1] is distinct from 'Kara Käufer' or v_namen[2] is not null then
    raise exception 'Ersatzname für alte Bestellungen falsch: %', v_namen;
  end if;

  -- Ändern über den Ticketlink.
  select code into v_code from tickets where bestellung_id = v_b1 order by erstellt_am, id offset 1 limit 1;
  if aendere_ticketname(v_token, lower(v_code), '  Dana   Vier ') <> 'ok' then
    raise exception 'aendere_ticketname ändert nicht';
  end if;
  select gast_name into v_name from tickets where code = v_code;
  if v_name <> 'Dana Vier' then
    raise exception 'aendere_ticketname bereinigt nicht: %', v_name;
  end if;
  if aendere_ticketname(v_token, v_code, 'Dana') <> 'name' then
    raise exception 'aendere_ticketname nimmt einen halben Namen';
  end if;
  if aendere_ticketname(v_token, v_code, 'anna eins') <> 'doppelt' then
    raise exception 'aendere_ticketname nimmt einen Namen doppelt';
  end if;
  if aendere_ticketname(repeat('x', 64), v_code, 'Eva Fünf') <> 'unbekannt' then
    raise exception 'aendere_ticketname ohne passenden Link';
  end if;
  update events set beginn = now() - interval '1 minute' where id = v_ev;
  if aendere_ticketname(v_token, v_code, 'Eva Fünf') <> 'zu_spaet' then
    raise exception 'aendere_ticketname nach Beginn';
  end if;

  if not exists (select 1 from pg_proc where proname = 'entwerte_ticket' and prosrc like '%name_fehlt%') then
    raise exception 'entwerte_ticket meldet fehlende Namen nicht';
  end if;
  if has_function_privilege('anon', 'einlass_namen(uuid)', 'execute') then
    raise exception 'einlass_namen ist für anon aufrufbar';
  end if;
  if has_function_privilege('anon', 'aendere_ticketname(text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'aendere_ticketname(text, text, text)', 'execute') then
    raise exception 'aendere_ticketname ist ohne Dienstschlüssel aufrufbar';
  end if;
  if has_function_privilege('anon', 'bestaetige_zahlung(uuid, zahlungsart, text, int)', 'execute') then
    raise exception 'anon darf bestaetige_zahlung';
  end if;

  -- Aufräumen.
  delete from tickets where event_id = v_ev;
  delete from bestellpositionen where bestellung_id in (v_b1, v_b2);
  delete from bestellungen where id in (v_b1, v_b2);
  delete from phasen where event_id = v_ev;
  delete from events where id = v_ev;
  delete from kunden where id = v_kunde;
end $$;

commit;
