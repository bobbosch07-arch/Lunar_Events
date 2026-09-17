-- ============================================================
-- Lunar Events — Gästeliste
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Pflegen dürfen nur Admins. Lesen darf das Team.
--   * Jeder Eintrag hat eine eigene Zahl an Begleitungen (+1, +2 …).
--   * Am Einlass beides: QR-Code und Namensliste.
--   * Die Gästeliste kommt obendrauf — sie zieht keine Tickets aus den
--     Phasenkontingenten.
--
-- Der Kern: Jeder Eintrag erzeugt echte Tickets, eines je Person. Damit
-- laufen QR-Scan (entwerte_ticket), Prüfsummen für den Betrieb ohne Netz und
-- Namensliste über dieselben Zeilen — wer per QR drin ist, ist auf der
-- Namensliste abgehakt und umgekehrt, und niemand kommt doppelt rein.
-- Gäste-Tickets hängen an gaeste statt an einer Bestellung; alles, was
-- Verkäufe zählt, geht über Bestellungen und sieht sie deshalb nicht.
-- ============================================================

begin;

-- ---------- Tabelle ----------
create table if not exists gaeste (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  -- Freiwillig: Mit Adresse gehen die QR-Codes per Mail raus, ohne steht der
  -- Gast nur auf der Namensliste (oder bekommt den Link per Messenger).
  email        citext,
  begleitung   int not null default 0 check (begleitung between 0 and 10),
  notiz        text,
  -- Zugang zur Ticketseite, wie zugangstoken bei Bestellungen.
  token        text not null default
                 replace(gen_random_uuid()::text, '-', '') ||
                 replace(gen_random_uuid()::text, '-', ''),
  erstellt_am  timestamptz not null default now(),
  erstellt_von uuid references auth.users (id) on delete set null,
  mail_gesendet_am timestamptz,
  -- Entfernt wird nicht gelöscht: Wer schon drin war, bleibt nachvollziehbar.
  entfernt_am  timestamptz
);

create unique index if not exists gaeste_token_idx on gaeste (token);
create index if not exists gaeste_event_idx on gaeste (event_id) where entfernt_am is null;

alter table gaeste enable row level security;

-- Lesen fürs Team. Geschrieben wird nur über speichere_gast/entferne_gast,
-- die selbst auf Admin prüfen. Das Einlasspersonal bekommt die Liste über
-- gaesteliste_einlass() — ohne Mailadressen.
drop policy if exists gaeste_lesen on gaeste;
create policy gaeste_lesen on gaeste
  for select using (ist_mitarbeiter('team'));

-- ---------- Tickets ----------
alter table tickets alter column bestellung_id drop not null;
alter table tickets alter column phase_id drop not null;
alter table tickets
  add column if not exists gast_id uuid references gaeste (id) on delete cascade;

-- Ein Ticket kommt entweder aus einer Bestellung (mit Phase) oder von der
-- Gästeliste — nie beides, nie keins.
alter table tickets drop constraint if exists tickets_herkunft;
alter table tickets add constraint tickets_herkunft check (
  (bestellung_id is not null and phase_id is not null and gast_id is null)
  or (gast_id is not null and bestellung_id is null)
);

create index if not exists tickets_gast_idx on tickets (gast_id) where gast_id is not null;

-- ---------- Eintrag anlegen oder ändern ----------
-- Antwortet immer: ok (mit id und token), keine_berechtigung, name,
-- begleitung, unbekannt, schon_drin (weniger Personen als schon eingelassen).
-- Die Tickets werden an die Personenzahl angeglichen: fehlende kommen dazu,
-- überzählige noch nicht eingelöste werden storniert (die jüngsten zuerst).
create or replace function speichere_gast(
  p_id         uuid,
  p_event_id   uuid,
  p_name       text,
  p_email      text,
  p_begleitung int,
  p_notiz      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := trim(coalesce(p_name, ''));
  v_email  citext := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_gast   gaeste%rowtype;
  v_soll   int;
  v_aktiv  int;
  v_drin   int;
  v_i      int;
begin
  if not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if length(v_name) < 1 or length(v_name) > 120 then
    return jsonb_build_object('ergebnis', 'name');
  end if;
  if p_begleitung is null or p_begleitung < 0 or p_begleitung > 10 then
    return jsonb_build_object('ergebnis', 'begleitung');
  end if;

  v_soll := 1 + p_begleitung;

  if p_id is null then
    if not exists (select 1 from events where id = p_event_id) then
      return jsonb_build_object('ergebnis', 'unbekannt');
    end if;
    insert into gaeste (event_id, name, email, begleitung, notiz, erstellt_von)
    values (p_event_id, v_name, v_email, p_begleitung,
            nullif(trim(coalesce(p_notiz, '')), ''), auth.uid())
    returning * into v_gast;
  else
    select * into v_gast from gaeste where id = p_id and entfernt_am is null for update;
    if not found then
      return jsonb_build_object('ergebnis', 'unbekannt');
    end if;
    select count(*) into v_drin from tickets where gast_id = v_gast.id and status = 'entwertet';
    if v_soll < v_drin then
      return jsonb_build_object('ergebnis', 'schon_drin', 'drin', v_drin);
    end if;
    update gaeste
       set name = v_name,
           email = v_email,
           begleitung = p_begleitung,
           notiz = nullif(trim(coalesce(p_notiz, '')), '')
     where id = v_gast.id
    returning * into v_gast;
  end if;

  -- Tickets angleichen
  select count(*) into v_aktiv from tickets where gast_id = v_gast.id and status <> 'storniert';

  for v_i in 1..greatest(v_soll - v_aktiv, 0) loop
    insert into tickets (event_id, gast_id, phase_name, art, code)
    values (v_gast.event_id, v_gast.id, 'Gästeliste', 'standard', neuer_ticketcode());
  end loop;

  if v_aktiv > v_soll then
    update tickets set status = 'storniert'
     where id in (
       select id from tickets
        where gast_id = v_gast.id and status = 'gueltig'
        order by erstellt_am desc, id desc
        limit v_aktiv - v_soll
     );
  end if;

  -- Namen auf den Tickets: der Gast selbst auf dem ersten, "Begleitung" auf
  -- den übrigen. So steht es auch auf der Ticketseite.
  update tickets t
     set gast_name = case when r.nr = 1 then v_gast.name
                          else v_gast.name || ' · Begleitung' end
    from (
      select id, row_number() over (order by erstellt_am, id) as nr
        from tickets
       where gast_id = v_gast.id and status <> 'storniert'
    ) r
   where t.id = r.id;

  return jsonb_build_object('ergebnis', 'ok', 'id', v_gast.id, 'token', v_gast.token);
end;
$$;

-- ---------- Eintrag entfernen ----------
-- Storniert die noch nicht eingelösten Tickets; der Scanner zeigt dann
-- "Storniert". Wer schon drin ist, bleibt als eingelassen stehen.
create or replace function entferne_gast(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not ist_mitarbeiter('admin') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  update gaeste set entfernt_am = coalesce(entfernt_am, now()) where id = p_id;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  update tickets set status = 'storniert' where gast_id = p_id and status = 'gueltig';
  return jsonb_build_object('ergebnis', 'ok');
end;
$$;

-- ---------- Namensliste am Einlass ----------
-- Ohne Mailadressen: Am Eingang braucht niemand mehr als Name, Anzahl und
-- Notiz. Antwortet ohne Rolle mit einer leeren Liste statt mit einem Fehler.
create or replace function gaesteliste_einlass(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('einlass') then '[]'::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id,
               'name', g.name,
               'notiz', g.notiz,
               'personen', (select count(*) from tickets t
                             where t.gast_id = g.id and t.status <> 'storniert'),
               'drin', (select count(*) from tickets t
                         where t.gast_id = g.id and t.status = 'entwertet'))
             order by lower(g.name))
        from gaeste g
       where g.event_id = p_event_id and g.entfernt_am is null
    ), '[]'::jsonb)
  end;
$$;

-- ---------- Einlass über die Namensliste ----------
-- Entwertet bis zu p_anzahl noch gültige Tickets des Eintrags — dieselben,
-- die auch der QR-Scan entwertet. Wirft nie (wie entwerte_ticket): Am
-- Eingang muss sofort klar sein, was los ist.
--   ergebnis: gueltig | schon_drin | storniert | unbekannt | keine_berechtigung
create or replace function lasse_gast_ein(p_gast_id uuid, p_anzahl int default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gast     gaeste%rowtype;
  v_neu      int;
  v_personen int;
  v_drin     int;
begin
  if not ist_mitarbeiter('einlass') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_gast from gaeste where id = p_gast_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_gast.entfernt_am is not null then
    return jsonb_build_object('ergebnis', 'storniert', 'name', v_gast.name);
  end if;

  with frei as (
    select id from tickets
     where gast_id = v_gast.id and status = 'gueltig'
     order by erstellt_am, id
     limit greatest(coalesce(p_anzahl, 1), 0)
     for update
  )
  update tickets t
     set status = 'entwertet', entwertet_am = now(), entwertet_von = auth.uid()
    from frei
   where t.id = frei.id;
  get diagnostics v_neu = row_count;

  select count(*) filter (where status <> 'storniert'),
         count(*) filter (where status = 'entwertet')
    into v_personen, v_drin
    from tickets where gast_id = v_gast.id;

  return jsonb_build_object(
    'ergebnis', case when v_neu > 0 then 'gueltig' else 'schon_drin' end,
    'name', v_gast.name,
    'eingelassen', v_neu,
    'personen', v_personen,
    'drin', v_drin
  );
end;
$$;

-- ---------- Rechte (siehe 0012) ----------
-- Angemeldete Sitzung, die Funktion prüft die Rolle selbst.
revoke execute on function speichere_gast(uuid, uuid, text, text, int, text) from public, anon;
revoke execute on function entferne_gast(uuid) from public, anon;
revoke execute on function gaesteliste_einlass(uuid) from public, anon;
revoke execute on function lasse_gast_ein(uuid, int) from public, anon;

grant execute on function speichere_gast(uuid, uuid, text, text, int, text) to authenticated, service_role;
grant execute on function entferne_gast(uuid) to authenticated, service_role;
grant execute on function gaesteliste_einlass(uuid) to authenticated, service_role;
grant execute on function lasse_gast_ein(uuid, int) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  f text;
begin
  if not exists (select 1 from pg_class where relname = 'gaeste' and relrowsecurity) then
    raise exception 'gaeste ohne Zugriffsregeln';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tickets_herkunft') then
    raise exception 'tickets_herkunft fehlt';
  end if;

  foreach f in array array[
    'public.speichere_gast(uuid, uuid, text, text, int, text)',
    'public.entferne_gast(uuid)',
    'public.gaesteliste_einlass(uuid)',
    'public.lasse_gast_ein(uuid, int)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% ist ohne Anmeldung aufrufbar', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist für angemeldetes Personal nicht aufrufbar', f;
    end if;
  end loop;

  -- Ohne Sitzung gibt es keine Rolle: alles abgewiesen, nichts geworfen.
  if speichere_gast(null, gen_random_uuid(), 'X', null, 0, null) ->> 'ergebnis' <> 'keine_berechtigung'
     or entferne_gast(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or lasse_gast_ein(gen_random_uuid(), 1) ->> 'ergebnis' <> 'keine_berechtigung'
     or gaesteliste_einlass(gen_random_uuid()) <> '[]'::jsonb then
    raise exception 'Gästeliste lässt ohne Rolle etwas zu';
  end if;
end $$;
