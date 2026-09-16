-- ============================================================
-- Lunar Events — Wie lange eine Anmeldung fürs Personal gilt
--
-- Anlass: Ein Admin war drei Tage lang angemeldet, ohne sich neu
-- anzumelden. Supabase frischt Sitzungen von selbst auf, und im
-- kostenlosen Tarif lässt sich ihre Höchstdauer nicht begrenzen.
--
-- Die Grenze steht deshalb hier, in ist_mitarbeiter(): Jede Zugriffsregel
-- fürs Personal, der Scanner und die Auswertung laufen darüber. Gemessen
-- wird ab der echten Anmeldung — dem Zeitpunkt in `amr` des Tokens. Der
-- bleibt beim Auffrischen gleich, während `iat` jede Stunde neu gesetzt
-- wird (geprüft am 16.09.2026 mit einer echten Sitzung).
--
--   admin, team   8 Stunden
--   einlass      12 Stunden — eine ganze Nacht am Eingang
--
-- Dieselben Werte stehen in src/lib/sitzung.ts für die Oberfläche. Ändert
-- sich eine Zahl, müssen beide mit.
--
-- Die eigene Mitarbeiterzeile bleibt lesbar (Regel `user_id = auth.uid()`),
-- damit die Oberfläche die Rolle kennt und zur neuen Anmeldung schicken
-- kann, statt nur leere Seiten zu zeigen.
-- ============================================================

begin;

create or replace function ist_mitarbeiter(mindestens text default 'einlass')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from mitarbeiter m
    where m.user_id = auth.uid()
      and m.aktiv
      and case mindestens
            when 'admin'   then m.rolle = 'admin'
            when 'team'    then m.rolle in ('admin', 'team')
            else true
          end
      -- Jüngster Anmeldezeitpunkt aus amr (bei mehreren Faktoren mehrere
      -- Einträge). Fehlt amr, gilt die Anmeldung als abgelaufen.
      and coalesce(
            (select max((eintrag ->> 'timestamp')::bigint)
               from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) eintrag),
            0
          ) > extract(epoch from now())::bigint
              - (case when m.rolle = 'einlass' then 12 else 8 end) * 3600
  );
$$;

-- create or replace behält die Rechte. Zur Sicherheit ausdrücklich: Die
-- Funktion steckt in Zugriffsregeln und muss für alle aufrufbar bleiben.
grant execute on function ist_mitarbeiter(text) to anon, authenticated, service_role;

commit;

-- ---------- Selbstprüfung: frische und alte Anmeldung simulieren ----------
do $$
declare
  v_person uuid;
  v_rolle  text;
  v_jetzt  bigint := extract(epoch from now())::bigint;
  v_frisch boolean;
  v_alt    boolean;
begin
  select user_id, rolle into v_person, v_rolle
    from mitarbeiter where aktiv limit 1;

  if v_person is null then
    raise notice 'Kein aktives Personal — Laufzeitprüfung übersprungen';
    return;
  end if;

  -- auth.uid() und auth.jwt() lesen diese Einstellung.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_person, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', v_jetzt - 60))
  )::text, true);
  v_frisch := ist_mitarbeiter('einlass');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_person, 'role', 'authenticated',
    'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', v_jetzt - 3 * 86400))
  )::text, true);
  v_alt := ist_mitarbeiter('einlass');

  perform set_config('request.jwt.claims', '', true);

  if not v_frisch then
    raise exception 'Frische Anmeldung (vor 1 Minute) wird abgelehnt — Rolle %', v_rolle;
  end if;
  if v_alt then
    raise exception 'Drei Tage alte Anmeldung wird noch akzeptiert — Rolle %', v_rolle;
  end if;
  if not has_function_privilege('anon', 'public.ist_mitarbeiter(text)', 'execute') then
    raise exception 'ist_mitarbeiter nicht mehr für Zugriffsregeln aufrufbar';
  end if;
end $$;
