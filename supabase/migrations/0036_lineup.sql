-- ============================================================
-- Lunar Events — Line-up je Event (C9)
--
-- Bisher standen die Namen nur im Fließtext der Beschreibung. Ein eigenes
-- Feld macht sie strukturiert sichtbar (Eventseite) und später leicht
-- weiterzureichen. Nur Namen, keine Zeiten — eine Textliste.
-- ============================================================

begin;

alter table events
  add column if not exists lineup text[] not null default '{}';

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'events' and column_name = 'lineup') then
    raise exception 'events.lineup fehlt';
  end if;
end $$;
