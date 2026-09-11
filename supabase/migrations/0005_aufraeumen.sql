-- ============================================================
-- Lunar Events — Abgelaufene Reservierungen automatisch freigeben
--
-- Bis hierher gab raeume_reservierungen_auf() Kontingente nur frei,
-- wenn jemand im Backoffice den Knopf drückte. Beim Vorverkauf einer
-- ausverkauften Nacht ist das zu selten: Jede nicht bezahlte
-- Reservierung blockiert 15 Minuten lang einen Platz, den jemand
-- anderes sofort gekauft hätte.
-- ============================================================

begin;

create extension if not exists pg_cron with schema extensions;

-- Alte Fassung entfernen, damit die Migration wiederholbar bleibt.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lunar_reservierungen') then
    perform cron.unschedule('lunar_reservierungen');
  end if;
exception
  when undefined_table then
    -- pg_cron noch nicht bereit; der Zeitplan unten legt sie an.
    null;
end $$;

-- Alle fünf Minuten. Häufiger brächte nichts: die Frist beträgt 15
-- Minuten, und ein Platz, der fünf Minuten zu spät frei wird, ist kein
-- Problem. Seltener schon.
select cron.schedule(
  'lunar_reservierungen',
  '*/5 * * * *',
  $$select public.raeume_reservierungen_auf();$$
);

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'lunar_reservierungen') then
    raise exception 'Der Aufräum-Auftrag wurde nicht eingerichtet';
  end if;
end $$;
