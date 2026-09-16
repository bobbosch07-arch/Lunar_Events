-- ============================================================
-- Lunar Events — Einlass-Anmeldung gilt 24 statt 12 Stunden
--
-- Aus dem Fragebogen vom 16.09.2026: Das Einlass-Personal soll einen
-- ganzen Tag angemeldet bleiben. Admin und Team bleiben bei 8 Stunden.
-- Sonst unverändert gegenüber 0014; dieselben Zahlen stehen in
-- src/lib/sitzung.ts.
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
      and coalesce(
            (select max((eintrag ->> 'timestamp')::bigint)
               from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) eintrag),
            0
          ) > extract(epoch from now())::bigint
              - (case when m.rolle = 'einlass' then 24 else 8 end) * 3600
  );
$$;

grant execute on function ist_mitarbeiter(text) to anon, authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_person uuid;
  v_rolle  text;
  v_jetzt  bigint := extract(epoch from now())::bigint;
  v_frisch boolean;
  v_alt    boolean;
begin
  select user_id, rolle into v_person, v_rolle from mitarbeiter where aktiv limit 1;
  if v_person is null then
    raise notice 'Kein aktives Personal — Laufzeitprüfung übersprungen';
    return;
  end if;

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

  if not v_frisch then raise exception 'Frische Anmeldung abgelehnt — Rolle %', v_rolle; end if;
  if v_alt then raise exception 'Drei Tage alte Anmeldung akzeptiert — Rolle %', v_rolle; end if;
  if not exists (select 1 from pg_proc where proname = 'ist_mitarbeiter' and prosrc like '%then 24 else 8%') then
    raise exception 'Neue Einlass-Dauer nicht aktiv';
  end if;
end $$;
