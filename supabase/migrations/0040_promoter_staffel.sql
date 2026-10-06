-- ============================================================
-- Lunar Events — Promoter: Codes ohne Rabatt, Weg je Bestellung, Staffel
-- (06.10.2026, Promo-Konzept „THE OPENING promo.“)
--
-- 1. Ein Code, der einem Promoter gehört, darf 0 € haben. Er gibt dann
--    keinen Rabatt und dient nur der Zuordnung („Sicherheitscode“ aus dem
--    Konzept): Wer den Link nicht nutzt, aber den Code nennt, zählt trotzdem.
-- 2. Jede Bestellung merkt sich, wie sie zum Promoter kam: über den Link,
--    den Code oder beides. Gezählt wird weiter je Bestellung mit ihren
--    Tickets, nie doppelt: Link und Code derselben Person sind eine
--    Bestellung.
-- 3. Staffel je Event (`promoter_stufen`) und ein Stichtag
--    (`events.promo_stichtag`): Für Staffel und Rangliste zählen nur
--    bezahlte, nicht stornierte Tickets bis dahin. Der Promoter sieht auf
--    seiner Seite seinen Fortschritt, nur seine eigene Zahl.
-- ============================================================

begin;

-- ---------- 1. Codes ohne Rabatt ----------
alter table rabattcodes drop constraint if exists rabattcodes_wert;
alter table rabattcodes add constraint rabattcodes_wert check (
  wert >= 0
  and (wert > 0 or oeffnet_presale or promoter_id is not null)
  and (art <> 'prozent' or wert <= 100)
);

-- ---------- 2. Weg je Bestellung ----------
alter table bestellungen
  add column if not exists promoter_weg text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bestellungen_promoter_weg') then
    alter table bestellungen add constraint bestellungen_promoter_weg
      check (promoter_weg is null or promoter_weg in ('link', 'code', 'beides'));
  end if;
end $$;

-- Vorrang hat weiter der Code. Neu: Kam die Bestellung über Link UND Code
-- derselben Person, heißt der Weg „beides“; über den Link eines anderen
-- zählt allein der Code. Eine gesetzte Zuordnung wird nie überschrieben.
create or replace function ordne_promoter_zu(p_bestellung_id uuid, p_kuerzel text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code uuid;
  v_link uuid;
  v_id   uuid;
begin
  select r.promoter_id
    into v_code
    from bestellungen b
    join rabattcodes r on r.id = b.rabattcode_id
    join promoter p on p.id = r.promoter_id and p.aktiv
   where b.id = p_bestellung_id;

  select p.id
    into v_link
    from promoter p
   where p.kuerzel = lower(trim(coalesce(p_kuerzel, '')))
     and p.aktiv;

  v_id := coalesce(v_code, v_link);
  if v_id is null then
    return null;
  end if;

  update bestellungen
     set promoter_id  = v_id,
         promoter_weg = case
                          when v_code is not null and v_code = v_link then 'beides'
                          when v_code is not null then 'code'
                          else 'link'
                        end
   where id = p_bestellung_id
     and promoter_id is null;

  return (select promoter_id from bestellungen where id = p_bestellung_id);
end;
$$;

-- ---------- 3. Staffel und Stichtag ----------
alter table events
  add column if not exists promo_stichtag timestamptz;

create table if not exists promoter_stufen (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events (id) on delete cascade,
  ab_tickets int  not null check (ab_tickets between 1 and 1000),
  belohnung  text not null check (length(trim(belohnung)) between 1 and 200),
  unique (event_id, ab_tickets)
);

alter table promoter_stufen enable row level security;
revoke all on table promoter_stufen from anon;

drop policy if exists promoter_stufen_lesen on promoter_stufen;
create policy promoter_stufen_lesen on promoter_stufen
  for select using (ist_mitarbeiter('team'));

drop policy if exists promoter_stufen_pflegen on promoter_stufen;
create policy promoter_stufen_pflegen on promoter_stufen
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

-- Tickets eines Promoters für ein Event: bezahlte Bestellungen, ohne
-- stornierte Tickets. Mit p_bis nur Bestellungen, die bis dahin bezahlt
-- wurden (Stichtag).
create or replace function promoter_tickets(p_promoter uuid, p_event uuid, p_bis timestamptz default null)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(t.id)::int
    from bestellungen b
    join tickets t on t.bestellung_id = b.id and t.status <> 'storniert'
   where b.promoter_id = p_promoter
     and b.event_id = p_event
     and b.status = 'bezahlt'
     and (p_bis is null or b.bezahlt_am <= p_bis);
$$;

revoke execute on function promoter_tickets(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function promoter_tickets(uuid, uuid, timestamptz) to service_role;

-- ---------- Statistik hinter dem geheimen Link ----------
-- Wie in 0018, dazu je Event: Tickets bis zum Stichtag, Aufteilung nach
-- Weg, Stichtag und Staffel. Tickets zählen jetzt aus `tickets` statt aus
-- den Bestellpositionen, damit einzeln stornierte nicht mitzählen.
create or replace function promoter_statistik(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p promoter%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into v_p from promoter where token = p_token;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'name', v_p.name,
    'kuerzel', v_p.kuerzel,
    'aktiv', v_p.aktiv,
    'events', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.beginn desc)
        from (
          select e.id,
                 e.titel,
                 e.slug,
                 e.beginn,
                 (e.status = 'veroeffentlicht' and e.beginn > now()) as kommend,
                 (select count(*)
                    from ereignisse x
                   where x.promoter_id = v_p.id
                     and x.event_id = e.id
                     and x.art = 'event_gesehen')::int as klicks,
                 promoter_tickets(v_p.id, e.id) as tickets,
                 promoter_tickets(v_p.id, e.id, e.promo_stichtag) as tickets_staffel,
                 e.promo_stichtag as stichtag,
                 (select jsonb_build_object(
                           'link',    count(t.id) filter (where b.promoter_weg = 'link'),
                           'code',    count(t.id) filter (where b.promoter_weg = 'code'),
                           'beides',  count(t.id) filter (where b.promoter_weg = 'beides'),
                           'frueher', count(t.id) filter (where b.promoter_weg is null))
                    from bestellungen b
                    join tickets t on t.bestellung_id = b.id and t.status <> 'storniert'
                   where b.promoter_id = v_p.id
                     and b.event_id = e.id
                     and b.status = 'bezahlt') as weg,
                 coalesce((select jsonb_agg(jsonb_build_object('ab', s.ab_tickets, 'belohnung', s.belohnung)
                                            order by s.ab_tickets)
                             from promoter_stufen s
                            where s.event_id = e.id), '[]'::jsonb) as stufen
            from events e
           where (e.status = 'veroeffentlicht' and e.beginn > now())
              or exists (select 1 from bestellungen b
                          where b.promoter_id = v_p.id and b.event_id = e.id
                            and b.status = 'bezahlt')
              or exists (select 1 from ereignisse x
                          where x.promoter_id = v_p.id and x.event_id = e.id)
        ) z
    ), '[]'::jsonb),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'art', r.art, 'wert', r.wert, 'event_id', r.event_id)
             order by r.code)
        from rabattcodes r
       where r.promoter_id = v_p.id
         and r.aktiv
         and (r.gueltig_ab is null or r.gueltig_ab <= now())
         and (r.gueltig_bis is null or r.gueltig_bis > now())
         and (r.max_tickets is null or r.eingeloest < r.max_tickets)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function promoter_statistik(text) from public, anon, authenticated;
grant execute on function promoter_statistik(text) to service_role;

-- ---------- Rangliste fürs Backoffice ----------
-- Nur für Admins. Bei Gleichstand gewinnt laut Konzept, wer die Zahl zuerst
-- erreicht hat: Das ist der Zeitpunkt der letzten Bestellung, die zur
-- heutigen Zahl beigetragen hat.
create or replace function promoter_rangliste(p_event_id uuid)
returns table (
  promoter_id  uuid,
  name         text,
  aktiv        boolean,
  tickets      int,
  link         int,
  code         int,
  beides       int,
  frueher      int,
  erreicht_am  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bis timestamptz;
begin
  if not ist_mitarbeiter('admin') then
    raise exception 'NUR_ADMIN';
  end if;
  select promo_stichtag into v_bis from events where id = p_event_id;

  return query
    select p.id,
           p.name,
           p.aktiv,
           count(t.id)::int,
           (count(t.id) filter (where b.promoter_weg = 'link'))::int,
           (count(t.id) filter (where b.promoter_weg = 'code'))::int,
           (count(t.id) filter (where b.promoter_weg = 'beides'))::int,
           (count(t.id) filter (where b.promoter_weg is null))::int,
           max(b.bezahlt_am)
      from promoter p
      join bestellungen b on b.promoter_id = p.id
                         and b.event_id = p_event_id
                         and b.status = 'bezahlt'
                         and (v_bis is null or b.bezahlt_am <= v_bis)
      join tickets t on t.bestellung_id = b.id and t.status <> 'storniert'
     group by p.id, p.name, p.aktiv
     order by count(t.id) desc, max(b.bezahlt_am) asc;
end;
$$;

revoke execute on function promoter_rangliste(uuid) from public, anon;
grant execute on function promoter_rangliste(uuid) to authenticated, service_role;

-- ---------- Staffel für THE OPENING aus dem Konzept ----------
-- Nur, wenn es das Event gibt und noch keine Staffel hat. Stichtag drei Tage
-- vorher, am 11.11. um Mitternacht (deutsche Zeit).
do $$
declare
  v_event uuid;
begin
  select id into v_event from events where slug = 'the-opening';
  if v_event is null or exists (select 1 from promoter_stufen where event_id = v_event) then
    return;
  end if;
  insert into promoter_stufen (event_id, ab_tickets, belohnung) values
    (v_event, 5,  '1 Gratis-Ticket'),
    (v_event, 10, 'Fast Lane + 1 Shot'),
    (v_event, 15, '1 Mische'),
    (v_event, 20, '2. Gratis-Ticket für einen Freund + 2 Drinks pro Ticket');
  update events
     set promo_stichtag = '2026-11-11 23:59:59 Europe/Berlin'::timestamptz
   where id = v_event
     and promo_stichtag is null;
end $$;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_ort    uuid;
  v_event  uuid;
  v_p      uuid;
  v_code   uuid;
begin
  -- 0-€-Code nur mit Promoter
  select id into v_ort from orte limit 1;
  insert into events (slug, titel, kategorie, status, beginn, ort_id, veranstalter)
    values ('selbsttest-0040-' || gen_random_uuid(), 'SELBSTTEST', 'club', 'entwurf', now() + interval '30 days', v_ort, 'Lunar Events')
    returning id into v_event;
  insert into promoter (name, kuerzel) values ('Selbsttest', 'selbsttest-' || substr(md5(random()::text), 1, 8))
    returning id into v_p;

  begin
    insert into rabattcodes (code, art, wert) values ('SELBST0040A', 'betrag', 0);
    raise exception 'Code ohne Rabatt und ohne Promoter angenommen';
  exception when check_violation then null;
  end;
  insert into rabattcodes (code, art, wert, promoter_id) values ('SELBST0040B', 'betrag', 0, v_p)
    returning id into v_code;

  insert into promoter_stufen (event_id, ab_tickets, belohnung) values (v_event, 5, 'Test');
  if promoter_tickets(v_p, v_event) <> 0 then raise exception 'promoter_tickets zählt aus dem Nichts'; end if;

  delete from rabattcodes where id = v_code;
  delete from promoter where id = v_p;
  delete from events where id = v_event;

  if has_function_privilege('anon', 'public.promoter_statistik(text)', 'execute')
     or has_function_privilege('authenticated', 'public.promoter_statistik(text)', 'execute') then
    raise exception 'promoter_statistik ist öffentlich aufrufbar';
  end if;
  if has_function_privilege('anon', 'public.promoter_tickets(uuid, uuid, timestamptz)', 'execute') then
    raise exception 'promoter_tickets ist öffentlich aufrufbar';
  end if;
  if has_function_privilege('anon', 'public.promoter_rangliste(uuid)', 'execute') then
    raise exception 'promoter_rangliste ist für anon aufrufbar';
  end if;
  if has_table_privilege('anon', 'promoter_stufen', 'select') then
    raise exception 'anon darf promoter_stufen lesen';
  end if;
end $$;
