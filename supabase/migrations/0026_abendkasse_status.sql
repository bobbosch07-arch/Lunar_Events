-- ============================================================
-- Lunar Events — Abendkasse: Bestellstatus richtig eingetragen
--
-- 0025 trug den Status einer Tür-Bestellung als Text ein. PostgreSQL wandelt
-- Text beim Einfügen nicht von selbst in den Aufzählungstyp bestell_status —
-- der erste echte Verkauf im Prüfskript scheiterte daran. Sonst unverändert.
-- ============================================================

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
     (case when p_zahlung = 'bar' then 'bezahlt' else 'offen' end)::bestell_status,
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

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'verkaufe_abendkasse'
                  and prosrc like '%)::bestell_status%') then
    raise exception 'verkaufe_abendkasse() trägt den Status noch als Text ein';
  end if;
  if has_function_privilege('anon', 'public.verkaufe_abendkasse(uuid, uuid, int, text, boolean, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.verkaufe_abendkasse(uuid, uuid, int, text, boolean, text)', 'execute') then
    raise exception 'Rechte an verkaufe_abendkasse() verrutscht';
  end if;
end $$;
