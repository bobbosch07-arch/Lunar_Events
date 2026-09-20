-- ============================================================
-- Lunar Events — Bezahlung prueft den Betrag
--
-- Gefunden im Sicherheitsaudit (19.09.2026): bestaetige_zahlung() stellte
-- Tickets aus, ohne zu pruefen, wie viel tatsaechlich gezahlt wurde. Bei
-- Stripe folgt der Betrag zwar immer aus gesamt_cent, bei PayPal liesse
-- sich aber die Bestaetigung einer billigen Zahlung an eine teure
-- Bestellung haengen. Diese Migration zieht die Pruefung an die eine
-- Stelle, durch die jede Zahlung laeuft.
--
-- Der neue Parameter ist optional (default null): Vorkasse und
-- Freibestellungen haben keinen externen Betrag und rufen wie bisher auf.
-- Die Zahlwege mit echtem Geld (Stripe, PayPal) reichen den abgebuchten
-- Betrag jetzt durch. Der Funktionskoerper ist bis auf die eine Pruefung
-- maschinell aus 0027 uebernommen.
-- ============================================================

begin;

-- Die alte 3-Argument-Fassung muss weichen, sonst gaebe es zwei
-- Ueberladungen und ein Aufruf ohne Betrag umginge die neue Fassung.
drop function if exists bestaetige_zahlung(uuid, zahlungsart, text);

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

-- Rechte wie in 0012, auf die neue Signatur.
revoke execute on function bestaetige_zahlung(uuid, zahlungsart, text, int) from public, anon, authenticated;
grant execute on function bestaetige_zahlung(uuid, zahlungsart, text, int) to service_role;

commit;

-- ---------- Selbstpruefung ----------
do $$
declare
  v_ev    uuid;
  v_ph    uuid;
  v_best  uuid;
  v_kunde uuid;
  v_ort   uuid;
  v_n     int;
  v_fehler boolean;
begin
  select id into v_ort from orte limit 1;
  insert into kunden (email) values ('selbsttest-0033-' || gen_random_uuid() || '@example.invalid')
    returning id into v_kunde;
  insert into events (slug, titel, kategorie, status, beginn, ort_id, veranstalter)
    values ('selbsttest-0033-' || gen_random_uuid(), 'SELBSTTEST', 'club',
            'entwurf', now() + interval '30 days', v_ort, 'Lunar Events')
    returning id into v_ev;
  insert into phasen (event_id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, aktiv, leistungen, position)
    values (v_ev, 'Test', 'standard', 2000, 0, 10, 0, true, '{}'::text[], 0)
    returning id into v_ph;
  insert into bestellungen (nummer, event_id, kunde_id, status, summe_cent, gebuehr_cent, gesamt_cent, reserviert_bis)
    values (neue_bestellnummer(), v_ev, v_kunde, 'offen', 2000, 0, 2000, now() + interval '1 hour')
    returning id into v_best;
  insert into bestellpositionen (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
    values (v_best, v_ph, 'Test', 1, 2000, 0);

  -- Falscher Betrag muss abprallen und darf nichts ausstellen.
  v_fehler := false;
  begin
    perform bestaetige_zahlung(v_best, 'stripe'::zahlungsart, 'ref', 999);
  exception when others then
    v_fehler := true;
  end;
  if not v_fehler then raise exception 'Betragspruefung greift nicht'; end if;
  select count(*) into v_n from tickets where bestellung_id = v_best;
  if v_n <> 0 then raise exception 'Trotz falschem Betrag Tickets ausgestellt'; end if;

  -- Richtiger Betrag geht durch.
  perform bestaetige_zahlung(v_best, 'stripe'::zahlungsart, 'ref', 2000);
  select count(*) into v_n from tickets where bestellung_id = v_best;
  if v_n <> 1 then raise exception 'Richtiger Betrag stellt kein Ticket aus'; end if;

  -- Aufraeumen.
  delete from tickets where bestellung_id = v_best;
  delete from bestellpositionen where bestellung_id = v_best;
  delete from bestellungen where id = v_best;
  delete from phasen where event_id = v_ev;
  delete from events where id = v_ev;
  delete from kunden where id = v_kunde;

  if has_function_privilege('anon', 'bestaetige_zahlung(uuid, zahlungsart, text, int)', 'execute') then
    raise exception 'anon darf bestaetige_zahlung';
  end if;
end $$;

