-- ============================================================
-- Lunar Events — Rollen und zweiter Faktor
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Rollen sind Aufgaben, keine Rechtestufen: admin, kasse, einlass,
--     bar, security, runner, toiletten. Die alte Bürorolle "team" fällt
--     weg — ins Backoffice kommen nur Admins.
--   * Scannen dürfen Einlass, Bar und Kasse (und Admins).
--   * Zwei Faktoren sind Pflicht für alle, die an Geld oder Kundendaten
--     kommen: admin und kasse.
--   * Security, Runner und Toiletten melden sich nur an, um ihren Plan zu
--     sehen (der Schichtplaner kommt als Nächstes).
--
-- Die Rechte hängen weiter allein an `ist_mitarbeiter()`, damit es eine
-- Stelle bleibt: Zugriffsregeln, Scanner und Backoffice fragen dieselbe
-- Funktion. Neu sind die Stufen "kasse" und "personal".
--
-- Der zweite Faktor wird **geschaltet** (betrieb.zwei_faktor = an|aus).
-- Grund: Sonst stünde zwischen dem Einspielen dieser Migration und der
-- Auslieferung der Oberfläche ein Backoffice, das zwei Faktoren verlangt,
-- ohne dass man sie einrichten könnte. Nach dem Einrichten wird auf "an"
-- gestellt — das ist ein einziges Update, kein Umbau.
-- ============================================================

begin;

-- ---------- Rollen ----------
do $$
declare
  v_alt int;
begin
  select count(*) into v_alt from mitarbeiter where rolle = 'team';
  if v_alt > 0 then
    raise exception 'Es gibt noch % Zeile(n) mit der alten Rolle "team" — vorher neu zuordnen '
      '(node scripts/mitarbeiter.mjs)', v_alt;
  end if;
end $$;

alter table mitarbeiter drop constraint if exists mitarbeiter_rolle_check;
alter table mitarbeiter add constraint mitarbeiter_rolle_check check (
  rolle in ('admin', 'kasse', 'einlass', 'bar', 'security', 'runner', 'toiletten')
);

-- ---------- Schalter für den zweiten Faktor ----------
insert into betrieb (schluessel, wert) values ('zwei_faktor', 'aus')
on conflict (schluessel) do nothing;

-- ---------- Wer darf was? ----------
-- Stufen:
--   admin     alles (Backoffice)
--   team      nur noch ein anderes Wort für admin — die alten
--             Zugriffsregeln sprechen diese Stufe an, und sie bleiben damit
--             gültig, ohne dass jede einzeln umgeschrieben werden muss
--   kasse     Geld annehmen: admin, kasse
--   einlass   scannen: admin, kasse, einlass, bar
--   personal  angemeldetes Personal überhaupt (eigener Plan)
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
            when 'team'    then m.rolle = 'admin'
            when 'kasse'   then m.rolle in ('admin', 'kasse')
            when 'einlass' then m.rolle in ('admin', 'kasse', 'einlass', 'bar')
            else true
          end
      -- Zwei Faktoren, wo es um Geld und Kundendaten geht. Solange der
      -- Schalter auf "aus" steht, reicht die einfache Anmeldung.
      and (
        m.rolle not in ('admin', 'kasse')
        or (select wert from betrieb where schluessel = 'zwei_faktor') is distinct from 'an'
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
      -- Gemessen ab der echten Anmeldung (amr), nicht ab dem letzten
      -- Auffrischen des Tokens. Admin und Kasse 8 Stunden, der Rest 24.
      and coalesce(
            (select max((eintrag ->> 'timestamp')::bigint)
               from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) eintrag),
            0
          ) > extract(epoch from now())::bigint
              - (case when m.rolle in ('admin', 'kasse') then 8 else 24 end) * 3600
  );
$$;

grant execute on function ist_mitarbeiter(text) to anon, authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_person uuid;
  v_jetzt  bigint := extract(epoch from now())::bigint;
  v_an     boolean;
  v_aus    boolean;
begin
  select user_id into v_person from mitarbeiter where rolle = 'admin' and aktiv limit 1;
  if v_person is null then
    raise notice 'Kein aktiver Admin — Laufzeitprüfung übersprungen';
    return;
  end if;

  -- Ein Admin mit frischer Anmeldung, aber ohne zweiten Faktor.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_person, 'role', 'authenticated', 'aal', 'aal1',
    'amr', json_build_array(json_build_object('method', 'password', 'timestamp', v_jetzt - 60))
  )::text, true);

  update betrieb set wert = 'aus' where schluessel = 'zwei_faktor';
  v_aus := ist_mitarbeiter('admin');
  update betrieb set wert = 'an' where schluessel = 'zwei_faktor';
  v_an := ist_mitarbeiter('admin');
  update betrieb set wert = 'aus' where schluessel = 'zwei_faktor';

  perform set_config('request.jwt.claims', '', true);

  if not v_aus then
    raise exception 'Mit abgeschaltetem Schalter kommt der Admin nicht durch';
  end if;
  if v_an then
    raise exception 'Der Schalter greift nicht: Admin ohne zweiten Faktor kam durch';
  end if;

  -- Die Stufen selbst, ohne Sitzung: alles zu.
  if ist_mitarbeiter('admin') or ist_mitarbeiter('kasse') or ist_mitarbeiter('einlass')
     or ist_mitarbeiter('personal') then
    raise exception 'Ohne Anmeldung ist etwas offen';
  end if;

  if not exists (select 1 from pg_proc where proname = 'ist_mitarbeiter'
                  and prosrc like '%zwei_faktor%' and prosrc like '%aal2%') then
    raise exception 'Der zweite Faktor steht nicht in ist_mitarbeiter()';
  end if;
  if exists (select 1 from mitarbeiter where rolle not in
             ('admin','kasse','einlass','bar','security','runner','toiletten')) then
    raise exception 'Es gibt Personal mit einer unbekannten Rolle';
  end if;
end $$;
