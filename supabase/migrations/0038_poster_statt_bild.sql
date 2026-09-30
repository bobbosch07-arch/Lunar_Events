-- ============================================================
-- Lunar Events — Automatisches Poster statt Bild (30.09.2026)
--
-- Events ohne Foto zeigen seit dem neuen Look ein erzeugtes Poster
-- (Verlauf, Sichel, Titel). Mit diesem Schalter zeigt ein Event das
-- Poster auch dann, wenn ein Bild hochgeladen ist — das Bild bleibt
-- gespeichert und kommt zurück, sobald der Schalter wieder aus ist.
-- ============================================================

begin;

alter table events
  add column if not exists poster_statt_bild boolean not null default false;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'events' and column_name = 'poster_statt_bild') then
    raise exception 'events.poster_statt_bild fehlt';
  end if;
end $$;
