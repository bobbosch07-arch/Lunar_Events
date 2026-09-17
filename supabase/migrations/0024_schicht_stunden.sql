-- ============================================================
-- Lunar Events — Stunden einer Schicht, richtig gezählt
--
-- 0023 rechnete vom Einchecken bis zum **geplanten** Ende, solange noch
-- niemand ausgecheckt hatte. Beim Durchklicken fiel auf, was das anrichtet:
-- Wird jemand versehentlich Tage vor seiner Schicht eingecheckt, standen
-- plötzlich 148 Stunden im Plan.
--
-- Gemessen wird deshalb nur, wenn **beides** dasteht — Einchecken und
-- Auschecken. Vorher gilt die geplante Zeit. Dieselbe Regel steht in
-- `schichtStunden()` (src/lib/typen.ts).
-- ============================================================

begin;

create or replace function schicht_stunden(p_schicht schichten)
returns numeric
language sql
immutable
as $$
  select round(greatest(
    case
      when p_schicht.eingecheckt_am is not null and p_schicht.ausgecheckt_am is not null
        then extract(epoch from (p_schicht.ausgecheckt_am - p_schicht.eingecheckt_am))
      else extract(epoch from (p_schicht.ende - p_schicht.beginn))
    end / 3600.0 - p_schicht.pause_min / 60.0, 0)::numeric, 2);
$$;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_schicht schichten%rowtype;
begin
  v_schicht.beginn := timestamptz '2026-11-14 22:00 Europe/Berlin';
  v_schicht.ende   := timestamptz '2026-11-15 04:00 Europe/Berlin';
  v_schicht.pause_min := 30;

  -- Geplant: 6 Stunden minus Pause
  if schicht_stunden(v_schicht) <> 5.5 then
    raise exception 'Geplante Stunden falsch: %', schicht_stunden(v_schicht);
  end if;

  -- Eingecheckt, aber noch nicht ausgecheckt: weiter die geplante Zeit.
  -- Auch dann, wenn das Einchecken Tage daneben liegt.
  v_schicht.eingecheckt_am := timestamptz '2026-11-08 20:00 Europe/Berlin';
  if schicht_stunden(v_schicht) <> 5.5 then
    raise exception 'Laufende Schicht falsch: %', schicht_stunden(v_schicht);
  end if;

  -- Beides da: gemessen. Eine halbe Stunde später gekommen.
  v_schicht.eingecheckt_am := timestamptz '2026-11-14 22:30 Europe/Berlin';
  v_schicht.ausgecheckt_am := timestamptz '2026-11-15 04:00 Europe/Berlin';
  if schicht_stunden(v_schicht) <> 5.0 then
    raise exception 'Gearbeitete Stunden falsch: %', schicht_stunden(v_schicht);
  end if;

  -- Sofort wieder ausgecheckt: nie unter null
  v_schicht.ausgecheckt_am := v_schicht.eingecheckt_am;
  if schicht_stunden(v_schicht) <> 0 then
    raise exception 'Negative Stunden: %', schicht_stunden(v_schicht);
  end if;
end $$;
