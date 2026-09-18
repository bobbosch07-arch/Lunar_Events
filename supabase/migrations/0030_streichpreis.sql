-- ============================================================
-- Lunar Events — Streichpreis je Event
--
-- Entschieden am 18.09.2026: Neben den Online-Preisen steht dezent
-- durchgestrichen der Preis, den die Tür verlangen würde — ohne sichtbare
-- Beschriftung (Wunsch des Veranstalters, das Risiko einer irreführenden
-- Preisgegenüberstellung ist bekannt und in Kauf genommen). Eine Abendkasse
-- wird damit nicht versprochen; dafür gibt es weiter `events.abendkasse`.
--
-- Gibt es eine Abendkassen-Phase (0025), gilt deren Preis; dieses Feld
-- braucht es für Events ohne Türverkauf über unsere Kasse.
-- ============================================================

begin;

alter table events
  add column if not exists streichpreis_cent int
    check (streichpreis_cent is null or streichpreis_cent > 0);

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'events' and column_name = 'streichpreis_cent') then
    raise exception 'events.streichpreis_cent fehlt';
  end if;
end $$;
