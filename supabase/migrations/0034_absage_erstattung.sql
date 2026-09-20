-- ============================================================
-- Lunar Events — Absage erstattet automatisch
--
-- Bisher setzte "abgesagt" nur den Status; die Ticketseite versprach aber
-- eine Erstattung (Fragebogen: "Automatisch voll ueber Stripe"). Diese
-- Migration bereitet die Datenseite vor: Tickets und Garderobenmarken
-- bezahlter Bestellungen werden storniert, Freibestellungen (0 €) gleich
-- geschlossen, Vorkasse und Bar zum manuellen Erstatten markiert. Die
-- eigentlichen Rueckzahlungen ueber Stripe/PayPal loest die Server-Aktion
-- aus (API), bestaetigt werden sie wie bisher ueber die Webhooks.
--
-- Ausgeloest wird das nicht automatisch beim Statuswechsel, sondern ueber
-- einen eigenen, bestaetigten Knopf im Backoffice: Geld an alle zurueck
-- darf kein Versehen aus einem Status-Menue sein.
-- ============================================================

begin;

alter table bestellungen
  add column if not exists erstattung_faellig boolean not null default false,
  add column if not exists erstattet_am        timestamptz,
  add column if not exists absage_mail_am       timestamptz;

-- Wer noch von Hand erstattet werden muss.
create index if not exists bestellungen_erstattung_faellig_idx
  on bestellungen (event_id) where erstattung_faellig;

-- Storniert Tickets und Marken der bezahlten Bestellungen eines abgesagten
-- Events, schliesst Freibestellungen und markiert Vorkasse/Bar zum manuellen
-- Erstatten. Gibt die Bestellungen zurueck, die ueber Stripe/PayPal
-- zurueckgezahlt werden muessen (die Aktion ruft dafuer die API). Mehrfach
-- aufrufbar: erstattete (erstattet_am gesetzt) kommen nicht erneut.
create or replace function storniere_fuer_absage(p_event_id uuid)
returns table (
  bestellung_id uuid,
  zahlungsart   zahlungsart,
  zahlung_ref   text,
  gesamt_cent   int,
  email         text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from events where id = p_event_id and status = 'abgesagt') then
    raise exception 'EVENT_NICHT_ABGESAGT';
  end if;

  -- Tickets bezahlter Bestellungen entwerten — das Event faellt aus.
  update tickets t
     set status = 'storniert'
   where t.event_id = p_event_id
     and t.status = 'gueltig'
     and exists (
       select 1 from bestellungen b
        where b.id = t.bestellung_id and b.status = 'bezahlt'
     );

  -- Garderobenmarken genauso, aber nur noch nicht abgegebene (wie im Webhook).
  update garderobe_marken m
     set status = 'storniert'
   where m.event_id = p_event_id
     and m.status = 'gueltig'
     and m.abgegeben_am is null
     and exists (
       select 1 from bestellungen b
        where b.id = m.bestellung_id and b.status = 'bezahlt'
     );

  -- Freibestellungen (Rabattcode, 0 €): nichts zu erstatten, gleich schliessen.
  update bestellungen b
     set status = 'storniert', erstattet_am = now()
   where b.event_id = p_event_id
     and b.status = 'bezahlt'
     and b.zahlungsart = 'frei'
     and b.erstattet_am is null;

  -- Vorkasse und Bar an der Abendkasse: von Hand ueberweisen.
  update bestellungen b
     set erstattung_faellig = true
   where b.event_id = p_event_id
     and b.status = 'bezahlt'
     and b.zahlungsart in ('vorkasse', 'abendkasse')
     and b.erstattet_am is null;

  -- Stripe und PayPal: ueber die API zurueckzahlen.
  return query
    select b.id, b.zahlungsart, b.zahlung_ref, b.gesamt_cent, k.email::text
      from bestellungen b
      join kunden k on k.id = b.kunde_id
     where b.event_id = p_event_id
       and b.status = 'bezahlt'
       and b.zahlungsart in ('stripe', 'paypal')
       and b.erstattet_am is null;
end;
$$;

revoke execute on function storniere_fuer_absage(uuid) from public, anon, authenticated;
grant execute on function storniere_fuer_absage(uuid) to service_role;

commit;

-- ---------- Selbstpruefung ----------
do $$
declare
  v_ort  uuid;
  v_ev   uuid;
  v_ph   uuid;
  v_k    uuid;
  v_b    uuid;
  v_n    int;
begin
  select id into v_ort from orte limit 1;
  insert into kunden (email) values ('selbsttest-0034-' || gen_random_uuid() || '@example.invalid')
    returning id into v_k;
  insert into events (slug, titel, kategorie, status, beginn, ort_id, veranstalter)
    values ('selbsttest-0034-' || gen_random_uuid(), 'SELBSTTEST', 'club',
            'veroeffentlicht', now() + interval '30 days', v_ort, 'Lunar Events')
    returning id into v_ev;
  insert into phasen (event_id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, aktiv, leistungen, position)
    values (v_ev, 'Test', 'standard', 2000, 0, 10, 0, true, '{}'::text[], 0)
    returning id into v_ph;
  insert into bestellungen (nummer, event_id, kunde_id, status, zahlungsart, zahlung_ref, summe_cent, gebuehr_cent, gesamt_cent, bezahlt_am)
    values (neue_bestellnummer(), v_ev, v_k, 'bezahlt', 'stripe', 'pi_test', 2000, 0, 2000, now())
    returning id into v_b;
  insert into tickets (bestellung_id, event_id, phase_id, phase_name, art, code)
    values (v_b, v_ev, v_ph, 'Test', 'standard', neuer_ticketcode());

  -- Ohne Absage muss die Funktion sich weigern.
  begin
    perform storniere_fuer_absage(v_ev);
    raise exception 'storniere_fuer_absage laeuft trotz veroeffentlicht';
  exception when others then
    if sqlerrm not like '%EVENT_NICHT_ABGESAGT%' then raise; end if;
  end;

  update events set status = 'abgesagt' where id = v_ev;
  select count(*) into v_n from storniere_fuer_absage(v_ev);
  if v_n <> 1 then raise exception 'Stripe-Bestellung nicht zum Erstatten zurueckgegeben: %', v_n; end if;
  select count(*) into v_n from tickets where bestellung_id = v_b and status = 'storniert';
  if v_n <> 1 then raise exception 'Ticket nicht storniert'; end if;

  -- Aufraeumen.
  delete from tickets where bestellung_id = v_b;
  delete from bestellungen where id = v_b;
  delete from phasen where event_id = v_ev;
  delete from events where id = v_ev;
  delete from kunden where id = v_k;
end $$;
