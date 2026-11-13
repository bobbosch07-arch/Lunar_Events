-- ============================================================
-- Lunar Events — Abendkasse: PayPal und Überweisung direkt (13.11.2026)
--
-- Entschieden 13.11.: An der Abendkasse soll Geld ohne Stripe-Gebühr
-- ankommen. Der Gast zahlt selbst — per paypal.me-Link oder per
-- Echtzeitüberweisung (GiroCode mit Betrag und Bestellnummer) — und zeigt
-- die Bestätigung auf seinem Handy. Die Kasse sieht das Geld nicht selbst
-- eingehen; deshalb bestätigt die Crew ausdrücklich („Zahlung gesehen“).
--
-- Ablauf wie bei der Kartenzahlung per QR (0025): Die Bestellung entsteht
-- offen und hält die Tickets 20 Minuten. Erst die Bestätigung stellt sie
-- aus (bestaetige_zahlung) und lässt auf Wunsch gleich ein.
--
-- Neue Zahlarten `paypal_direkt` und `ueberweisung` stehen schon beim
-- Anlegen an der Bestellung — damit die Bestätigung weiß, was sie bucht,
-- und der Kassenstand sie getrennt ausweist (Abgleich mit Konto und PayPal
-- nach dem Abend). Die Zahlart `paypal` bleibt der Weg über die
-- PayPal-Schnittstelle im Webshop.
-- ============================================================

-- Neue Enum-Werte dürfen nicht in derselben Transaktion benutzt werden,
-- in der sie entstehen — deshalb vor dem begin.
alter type zahlungsart add value if not exists 'paypal_direkt';
alter type zahlungsart add value if not exists 'ueberweisung';

begin;

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
  v_bar        boolean := p_zahlung = 'bar';
begin
  if not ist_mitarbeiter('kasse') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if p_menge is null or p_menge < 1 or p_menge > 20 then
    return jsonb_build_object('ergebnis', 'menge');
  end if;
  if p_zahlung is null or p_zahlung not in ('bar', 'qr', 'paypal', 'ueberweisung') then
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
     (case when v_bar then 'bezahlt' else 'offen' end)::bestell_status,
     v_summe, v_gebuehr, v_summe + v_gebuehr,
     (case p_zahlung
        when 'bar' then 'abendkasse'
        when 'paypal' then 'paypal_direkt'
        when 'ueberweisung' then 'ueberweisung'
      end)::zahlungsart,
     case when v_bar then 'bar' end,
     true,
     case when not v_bar then now() + interval '20 minutes' end,
     case when v_bar then now() end)
  returning * into v_bestellung;

  insert into bestellpositionen
    (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
  values
    (v_bestellung.id, v_phase.id, v_phase.name, p_menge, v_phase.preis_cent, v_phase.gebuehr_cent);

  if v_bar then
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
    'bezahlt', v_bar,
    'eingelassen', v_bar and p_einlassen,
    'codes', to_jsonb(v_codes)
  );
end;
$$;

-- „Zahlung gesehen“: Die Crew hat die Bestätigung auf dem Handy des Gastes
-- gesehen. Stellt die Tickets aus und lässt auf Wunsch gleich ein.
--   ergebnis: ok (mit eingelassen) | schon_bezahlt | nicht_offen |
--             falsche_art | unbekannt | keine_berechtigung
-- Auch nach Ablauf der 20 Minuten, solange die Bestellung noch offen ist:
-- Ist das Geld da, sollen die Tickets nicht an der Uhr scheitern.
create or replace function abendkasse_direkt_bestaetigen(p_bestellung_id uuid, p_einlassen boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_anzahl     int := 0;
begin
  if not ist_mitarbeiter('kasse') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_bestellung from bestellungen
   where id = p_bestellung_id and abendkasse
   for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_bestellung.zahlungsart is null
     or v_bestellung.zahlungsart::text not in ('paypal_direkt', 'ueberweisung') then
    return jsonb_build_object('ergebnis', 'falsche_art');
  end if;
  if v_bestellung.status = 'bezahlt' then
    return jsonb_build_object('ergebnis', 'schon_bezahlt', 'nummer', v_bestellung.nummer);
  end if;
  if v_bestellung.status <> 'offen' then
    return jsonb_build_object('ergebnis', 'nicht_offen', 'status', v_bestellung.status);
  end if;

  -- Wer bestätigt hat, steht in der Referenz — für den Abgleich danach.
  perform bestaetige_zahlung(p_bestellung_id, v_bestellung.zahlungsart, 'kasse:' || auth.uid()::text, null);

  if p_einlassen then
    update tickets
       set status = 'entwertet', entwertet_am = now(), entwertet_von = auth.uid()
     where bestellung_id = p_bestellung_id and status = 'gueltig';
    get diagnostics v_anzahl = row_count;
  end if;

  return jsonb_build_object('ergebnis', 'ok', 'nummer', v_bestellung.nummer, 'eingelassen', v_anzahl);
end;
$$;

revoke all on function abendkasse_direkt_bestaetigen(uuid, boolean) from public, anon;
grant execute on function abendkasse_direkt_bestaetigen(uuid, boolean) to authenticated, service_role;

-- Kassenstand: jede Zahlart einzeln. qr_cent bleibt die Karte (Stripe bzw.
-- PayPal-Schnittstelle), damit /kasse unverändert weiterläuft.
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
        'qr_cent', coalesce(sum(case when b.zahlungsart::text not in ('abendkasse', 'paypal_direkt', 'ueberweisung')
                                     then b.gesamt_cent else 0 end), 0),
        'paypal_direkt_cent', coalesce(sum(case when b.zahlungsart::text = 'paypal_direkt' then b.gesamt_cent else 0 end), 0),
        'ueberweisung_cent', coalesce(sum(case when b.zahlungsart::text = 'ueberweisung' then b.gesamt_cent else 0 end), 0),
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

-- ---------- Selbstprüfung ----------
do $$
begin
  if has_function_privilege('anon', 'abendkasse_direkt_bestaetigen(uuid, boolean)', 'execute') then
    raise exception 'abendkasse_direkt_bestaetigen für anon aufrufbar';
  end if;
  if not has_function_privilege('authenticated', 'abendkasse_direkt_bestaetigen(uuid, boolean)', 'execute') then
    raise exception 'Kasse kann abendkasse_direkt_bestaetigen nicht aufrufen';
  end if;
  if abendkasse_direkt_bestaetigen(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'abendkasse_direkt_bestaetigen ohne Anmeldung antwortet falsch';
  end if;
  if verkaufe_abendkasse(gen_random_uuid(), gen_random_uuid(), 1, 'paypal') ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'verkaufe_abendkasse ohne Anmeldung antwortet falsch';
  end if;
end $$;

commit;
