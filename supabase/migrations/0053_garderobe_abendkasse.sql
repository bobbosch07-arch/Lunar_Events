-- ============================================================
-- Lunar Events — Garderobe an der Abendkasse (14.11.2026)
--
-- Entschieden 14.11.: Garderobe wird oben an der Abendkasse verkauft, damit
-- unten keine zweite Kasse stehen muss. Kaufen kann jeder — zusammen mit
-- Abendkassen-Tickets oder allein (wer online gekauft hat). Der Gast bekommt
-- ein **körperliches Zeichen** (Stempel, Bändchen, Papiermarke); das System
-- zählt nur Stück und Geld. Es entstehen keine digitalen Marken
-- (garderobe_marken) und nichts davon ist online buchbar.
--
-- Deshalb eine eigene Spalte `bestellungen.kasse_garderobe` statt
-- `garderobe_menge`: Letztere lässt bestaetige_zahlung() Marken ausstellen
-- und raeume_reservierungen_auf() Kontingent zurückbuchen — beides soll hier
-- nicht passieren. Kein Bügel-Kontingent: Die Zeichen zählt unten niemand.
--
-- Preis: `events.garderobe_preis_cent` (derselbe wie online), eingeschaltet
-- mit `events.garderobe_abendkasse`. Online bleibt `garderobe_aktiv` zuständig.
-- ============================================================

begin;

alter table events
  add column if not exists garderobe_abendkasse boolean not null default false;

alter table bestellungen
  add column if not exists kasse_garderobe int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bestellungen_kasse_garderobe_gueltig') then
    alter table bestellungen add constraint bestellungen_kasse_garderobe_gueltig
      check (kasse_garderobe between 0 and 20 and (kasse_garderobe = 0 or abendkasse));
  end if;
end $$;

-- Neuer Parameter p_garderobe — die alte Fassung muss weg, sonst gäbe es
-- zwei Funktionen gleichen Namens.
drop function if exists verkaufe_abendkasse(uuid, uuid, int, text, boolean, text);

create or replace function verkaufe_abendkasse(
  p_event_id  uuid,
  p_phase_id  uuid,
  p_menge     int,
  p_zahlung   text default 'bar',
  p_einlassen boolean default true,
  p_email     text default null,
  p_garderobe int default 0
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
  v_summe      int := 0;
  v_gebuehr    int := 0;
  v_garderobe  int := coalesce(p_garderobe, 0);
  v_i          int;
  v_codes      text[] := '{}';
  v_code       text;
  v_bar        boolean := p_zahlung = 'bar';
begin
  if not ist_mitarbeiter('kasse') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  -- Tickets 0 bis 20, Garderobe 0 bis 20 — aber nicht beides 0.
  if p_menge is null or p_menge < 0 or p_menge > 20
     or v_garderobe < 0 or v_garderobe > 20
     or (p_menge = 0 and v_garderobe = 0) then
    return jsonb_build_object('ergebnis', 'menge');
  end if;
  if p_zahlung is null or p_zahlung not in ('bar', 'qr', 'paypal', 'ueberweisung') then
    return jsonb_build_object('ergebnis', 'zahlungsart');
  end if;

  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'veroeffentlicht' then
    return jsonb_build_object('ergebnis', 'event_zu');
  end if;
  if v_garderobe > 0 and (not v_event.garderobe_abendkasse or v_event.garderobe_preis_cent <= 0) then
    return jsonb_build_object('ergebnis', 'garderobe_aus');
  end if;

  if p_menge > 0 then
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
    update phasen set verkauft = verkauft + p_menge where id = v_phase.id;
  end if;

  v_summe := v_summe + v_event.garderobe_preis_cent * v_garderobe;
  v_kunde := abendkasse_kunde(p_event_id, p_email);

  insert into bestellungen
    (nummer, event_id, kunde_id, status, summe_cent, gebuehr_cent, gesamt_cent,
     zahlungsart, zahlung_ref, abendkasse, reserviert_bis, bezahlt_am, kasse_garderobe)
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
     case when v_bar then now() end,
     v_garderobe)
  returning * into v_bestellung;

  if p_menge > 0 then
    insert into bestellpositionen
      (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
    values
      (v_bestellung.id, v_phase.id, v_phase.name, p_menge, v_phase.preis_cent, v_phase.gebuehr_cent);
  end if;

  if v_bar and p_menge > 0 then
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
    'garderobe', v_garderobe,
    'bezahlt', v_bar,
    'eingelassen', v_bar and p_einlassen and p_menge > 0,
    'codes', to_jsonb(v_codes)
  );
end;
$$;

revoke execute on function verkaufe_abendkasse(uuid, uuid, int, text, boolean, text, int) from public, anon;
grant execute on function verkaufe_abendkasse(uuid, uuid, int, text, boolean, text, int)
  to authenticated, service_role;

-- Kassenstand: dazu die verkauften Garderoben-Zeichen. Tickets zählen nur
-- Positionen, eine reine Garderoben-Bestellung trägt dort nichts bei.
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
        'garderobe', coalesce(sum(b.kasse_garderobe), 0),
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
  if has_function_privilege('anon', 'verkaufe_abendkasse(uuid, uuid, int, text, boolean, text, int)', 'execute') then
    raise exception 'verkaufe_abendkasse für anon aufrufbar';
  end if;
  if not has_function_privilege('authenticated', 'verkaufe_abendkasse(uuid, uuid, int, text, boolean, text, int)', 'execute') then
    raise exception 'Kasse kann verkaufe_abendkasse nicht aufrufen';
  end if;
  if exists (select 1 from pg_proc where proname = 'verkaufe_abendkasse' and pronargs = 6) then
    raise exception 'Alte verkaufe_abendkasse noch da';
  end if;
  if verkaufe_abendkasse(gen_random_uuid(), null, 0, 'bar', true, null, 1) ->> 'ergebnis' <> 'keine_berechtigung' then
    raise exception 'verkaufe_abendkasse ohne Anmeldung antwortet falsch';
  end if;
end $$;

commit;
