-- ============================================================
-- Lunar Events — Vorkasse per Überweisung
--
-- Wer per Überweisung zahlt, bekommt einen Rabatt in Höhe der
-- Servicegebühren. Ausdrücklich ein Rabatt und kein Aufschlag auf die
-- anderen Zahlungsarten: Für Überweisung, Lastschrift und Karte darf
-- kein zusätzliches Entgelt verlangt werden (§ 270a BGB), ein Nachlass
-- für eine bestimmte Zahlungsart ist dagegen zulässig. Die Servicegebühr
-- selbst bleibt für alle gleich.
--
-- Ablauf: reserviere() wie immer, dann waehle_vorkasse(). Die Bestellung
-- bleibt "offen", die Frist wird auf Tage verlängert. Tickets entstehen
-- erst, wenn das Team den Zahlungseingang bestätigt — über dasselbe
-- bestaetige_zahlung() wie bei Stripe und PayPal. Läuft die Frist ab,
-- gibt raeume_reservierungen_auf() die Plätze frei; dafür braucht es
-- nichts Neues.
-- ============================================================

-- Außerhalb der Transaktion: Ein neuer Enum-Wert lässt sich in derselben
-- Transaktion, die ihn anlegt, nicht benutzen.
alter type zahlungsart add value if not exists 'vorkasse';

begin;

alter table bestellungen
  add column if not exists vorkasse    boolean not null default false,
  add column if not exists rabatt_cent int     not null default 0 check (rabatt_cent >= 0);

-- ---------- Vorkasse wählen ----------
-- Gibt das Ende der verlängerten Frist zurück. Mehrfach aufrufbar: Wer
-- zweimal klickt, bekommt dieselbe Frist, nicht zweimal Rabatt.
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

  -- Rabatt = Servicegebühren. summe_cent enthält Tickets und Fast Lane,
  -- gebuehr_cent nur die Servicegebühren; gesamt = summe + gebühr − rabatt.
  update bestellungen
     set vorkasse       = true,
         rabatt_cent    = v_bestellung.gebuehr_cent,
         gesamt_cent    = v_bestellung.summe_cent,
         reserviert_bis = v_bis
   where id = p_bestellung_id;

  return v_bis;
end;
$$;

-- Seit 0012 ist eine neue Funktion für niemanden aufrufbar, bis es
-- gewährt wird. Nur der Server wählt Vorkasse — nach der Prüfung, dass
-- die Bestellung dem Gast gehört.
revoke execute on function waehle_vorkasse(uuid, int, int) from public, anon, authenticated;
grant execute on function waehle_vorkasse(uuid, int, int) to service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'zahlungsart' and e.enumlabel = 'vorkasse'
  ) then
    raise exception 'Zahlungsart vorkasse fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'bestellungen' and column_name = 'rabatt_cent') then
    raise exception 'bestellungen.rabatt_cent fehlt';
  end if;
  if has_function_privilege('anon', 'public.waehle_vorkasse(uuid, int, int)', 'execute') then
    raise exception 'waehle_vorkasse ist öffentlich aufrufbar';
  end if;
  if not has_function_privilege('service_role', 'public.waehle_vorkasse(uuid, int, int)', 'execute') then
    raise exception 'Server kann waehle_vorkasse nicht aufrufen';
  end if;
end $$;
