-- ============================================================
-- Lunar Events — „Mein Plan“ in der Crew-App (30.10.2026)
--
-- Die Crew-App liest im Browser, nicht auf dem Server wie /plan. Die eigenen
-- Schichten wären über die Zugriffsregeln (0023) zwar sichtbar, das Event
-- dahinter aber nicht, solange es noch ein Entwurf ist — geplant wird meist
-- vor dem Veröffentlichen. /plan löst das mit dem Dienstschlüssel; hier gibt
-- eine Funktion genau das heraus, was zur eigenen Schicht gehört: Titel,
-- Beginn und Ort des Events, sonst nichts.
--
-- Kommende Schichten alle, vergangene die letzten 20 (für die Stunden).
-- Gerechnet wird mit schicht_stunden() — dieselbe Zahl wie in /plan und im
-- Backoffice. Ohne Teamzugehörigkeit eine leere Liste.
-- ============================================================

begin;

create or replace function meine_schichten()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('personal') then '[]'::jsonb else
    coalesce((
      select jsonb_agg(z.zeile order by z.beginn)
        from (
          select s.beginn,
                 jsonb_build_object(
                   'id', s.id,
                   'rolle', s.rolle,
                   'station', s.station,
                   'beginn', s.beginn,
                   'ende', s.ende,
                   'pause_min', s.pause_min,
                   'notiz', s.notiz,
                   'eingecheckt_am', s.eingecheckt_am,
                   'ausgecheckt_am', s.ausgecheckt_am,
                   'stunden', schicht_stunden(s),
                   'event', jsonb_build_object(
                     'titel', e.titel,
                     'beginn', e.beginn,
                     'ort', case when o.id is null then null else o.name || ', ' || o.stadt end
                   )
                 ) as zeile,
                 s.ende >= now() as kommt,
                 row_number() over (partition by s.ende >= now() order by s.beginn desc) as nr
            from schichten s
            join events e on e.id = s.event_id
            left join orte o on o.id = e.ort_id
           where s.user_id = auth.uid()
        ) z
       where z.kommt or z.nr <= 20
    ), '[]'::jsonb)
  end
$$;

revoke all on function meine_schichten() from public, anon;
grant execute on function meine_schichten() to authenticated, service_role;

-- ---------- Selbstprüfung ----------
do $$
begin
  if has_function_privilege('anon', 'meine_schichten()', 'execute') then
    raise exception 'meine_schichten für anon aufrufbar';
  end if;
  if not has_function_privilege('authenticated', 'meine_schichten()', 'execute') then
    raise exception 'Personal kann meine_schichten nicht aufrufen';
  end if;
  if meine_schichten() <> '[]'::jsonb then
    raise exception 'meine_schichten ohne Anmeldung liefert Daten';
  end if;
end $$;

commit;
