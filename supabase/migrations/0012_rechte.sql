-- ============================================================
-- Lunar Events — Wer darf welche Datenbankfunktion aufrufen?
--
-- Anlass: bestaetige_zahlung() ließ sich mit dem öffentlichen Schlüssel
-- aufrufen. PostgreSQL gibt EXECUTE auf neue Funktionen standardmäßig an
-- alle, und Supabase macht jede Funktion im Schema public über die API
-- erreichbar. Wer eine Bestellung reserviert hatte — die ID steht in der
-- Adresse der Bestätigungsseite —, konnte sich damit selbst Tickets
-- ausstellen, ohne zu zahlen. Die Funktionen laufen als `security
-- definer`, also mit vollen Rechten; die Zugriffsregeln der Tabellen
-- greifen darin nicht.
--
-- Grundsatz ab hier: Eine Funktion ist für niemanden aufrufbar, dem sie
-- nicht ausdrücklich gewährt wird.
--
--   service_role   Server mit Dienstschlüssel: Kasse, Webhooks
--   authenticated  angemeldete Sitzung: Scanner, Backoffice — die
--                  Funktion prüft die Rolle dann selbst
--   anon           nichts davon
--
-- Nicht angefasst: ist_mitarbeiter() und ist_eigener_kunde(). Die
-- stecken in den Zugriffsregeln der Tabellen und werden mit den Rechten
-- des Aufrufers ausgewertet — ohne EXECUTE schlüge jede Abfrage fehl.
-- ============================================================

begin;

-- ---------- Kauf: nur der Server ----------
revoke execute on function reserviere(uuid, jsonb, text, text, text, text, int, int)
  from public, anon, authenticated;
grant execute on function reserviere(uuid, jsonb, text, text, text, text, int, int)
  to service_role;

revoke execute on function bestaetige_zahlung(uuid, zahlungsart, text)
  from public, anon, authenticated;
grant execute on function bestaetige_zahlung(uuid, zahlungsart, text)
  to service_role;

revoke execute on function neue_bestellnummer() from public, anon, authenticated;
revoke execute on function neuer_ticketcode()   from public, anon, authenticated;
grant execute on function neue_bestellnummer() to service_role;
grant execute on function neuer_ticketcode()   to service_role;

-- ---------- Angemeldet: Funktion prüft selbst ----------
-- entwerte_ticket() antwortet ohne Einlass-Rolle mit "keine_berechtigung".
revoke execute on function entwerte_ticket(text) from public, anon;
grant execute on function entwerte_ticket(text) to authenticated, service_role;

-- Gibt nur abgelaufene Reservierungen frei — auch aufgerufen von Unbefugten
-- richtet sie keinen Schaden an. Der Knopf im Backoffice braucht sie.
revoke execute on function raeume_reservierungen_auf() from public, anon;
grant execute on function raeume_reservierungen_auf() to authenticated, service_role;

-- ---------- Auswertung: bisher ohne Rollenprüfung ----------
-- Die Funktion umgeht als security definer die Regel auf `ereignisse` und
-- lieferte deshalb jedem die Zahlen. Jetzt nur fürs Team.
create or replace function auswertung_je_event(p_tage int default 90)
returns table (
  event_id uuid,
  titel text,
  gesehen bigint,
  gewaehlt bigint,
  kasse bigint,
  gekauft bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,
         e.titel,
         count(*) filter (where z.art = 'event_gesehen')      as gesehen,
         count(*) filter (where z.art = 'ticket_gewaehlt')    as gewaehlt,
         count(*) filter (where z.art = 'kasse_begonnen')     as kasse,
         count(*) filter (where z.art = 'kauf_abgeschlossen') as gekauft
    from events e
    left join ereignisse z
      on z.event_id = e.id
     and z.stunde > now() - make_interval(days => p_tage)
   where ist_mitarbeiter('team')
   group by e.id, e.titel
   order by gesehen desc;
$$;

revoke execute on function auswertung_je_event(int) from public, anon;
grant execute on function auswertung_je_event(int) to authenticated, service_role;

-- ---------- Künftige Funktionen ----------
-- Sonst öffnet jede neu angelegte Funktion die Lücke wieder — und schon
-- ein drop + create (wie bei reserviere in 0011) setzt die Rechte zurück.
-- Wer künftig eine Funktion braucht, gewährt sie ausdrücklich.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  fehler text := '';
begin
  if has_function_privilege('anon', 'public.bestaetige_zahlung(uuid, zahlungsart, text)', 'execute') then
    fehler := fehler || ' anon darf bestaetige_zahlung;';
  end if;
  if has_function_privilege('authenticated', 'public.bestaetige_zahlung(uuid, zahlungsart, text)', 'execute') then
    fehler := fehler || ' authenticated darf bestaetige_zahlung;';
  end if;
  if has_function_privilege('anon', 'public.reserviere(uuid, jsonb, text, text, text, text, int, int)', 'execute') then
    fehler := fehler || ' anon darf reserviere;';
  end if;
  if has_function_privilege('anon', 'public.auswertung_je_event(int)', 'execute') then
    fehler := fehler || ' anon darf auswertung_je_event;';
  end if;
  if not has_function_privilege('service_role', 'public.bestaetige_zahlung(uuid, zahlungsart, text)', 'execute') then
    fehler := fehler || ' service_role darf bestaetige_zahlung nicht mehr;';
  end if;
  if not has_function_privilege('authenticated', 'public.entwerte_ticket(text)', 'execute') then
    fehler := fehler || ' Scanner kann nicht mehr entwerten;';
  end if;
  if not has_function_privilege('anon', 'public.ist_mitarbeiter(text)', 'execute') then
    fehler := fehler || ' ist_mitarbeiter fehlt fuer Zugriffsregeln;';
  end if;
  if fehler <> '' then
    raise exception 'Rechte stimmen nicht:%', fehler;
  end if;
end $$;
