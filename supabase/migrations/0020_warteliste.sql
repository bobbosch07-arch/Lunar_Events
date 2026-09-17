-- ============================================================
-- Lunar Events — Warteliste
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfrage 17.09.2026):
--
--   * Ist ein Event ausverkauft, trägt man sich mit Mailadresse und einer
--     Anzahl (1–4) ein. Auf der Liste steht erst, wer den Link in der
--     Bestätigungsmail angeklickt hat — eine vertippte Adresse hielte sonst
--     echte Tickets stundenlang fest. Die Reihenfolge zählt ab Bestätigung.
--   * Wird etwas frei, bekommt der Erste ein Angebot. Passt seine Anzahl
--     nicht in das, was frei ist, rückt der Nächste mit passender Anzahl vor;
--     der Erste bleibt vorne.
--   * Ein Angebot ist eine Reservierung wie jede andere — reserviere() mit
--     längerer Frist. Kontingent, Sperre, Verfall und Bezahlung laufen damit
--     durch die Wege, die es schon gibt. Die Warteliste merkt sich nur, zu
--     welchem Eintrag die Bestellung gehört.
--   * Frist: 4 Stunden ab Versand der Mail. Endet sie zwischen 0 und 10 Uhr,
--     gilt sie bis 10 Uhr. Spätestens bis Beginn des Events.
--
-- Freigewordene Plätze kommen fast nur aus verfallenen Reservierungen (es
-- gibt keine Rückgabe) oder daher, dass das Team Kontingent aufstockt. Der
-- Aufräumlauf gibt verfallene Plätze frei und verteilt sie im selben Takt an
-- die Warteliste — dazwischen kann niemand anderes zugreifen.
--
-- Mails verschickt die Anwendung, nicht die Datenbank. Liegen unverschickte
-- Angebote vor, ruft der Takt dafür eine Route auf (pg_net).
-- ============================================================

begin;

create extension if not exists pg_net;

-- ---------- Tabelle ----------
create table if not exists warteliste (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events (id) on delete cascade,
  email          citext not null,
  vorname        text,
  anzahl         int not null check (anzahl between 1 and 4),
  -- Für Bestätigen, Kaufen und Austragen — ohne Anmeldung, aus der Mail.
  token          text not null default
                   replace(gen_random_uuid()::text, '-', '') ||
                   replace(gen_random_uuid()::text, '-', ''),
  erstellt_am    timestamptz not null default now(),
  bestaetigt_am  timestamptz,
  bestaetigung_verschickt_am timestamptz,
  -- Selbst ausgetragen oder ein Angebot freigegeben.
  ausgetragen_am timestamptz,
  -- Das Angebot. angebot_am ist das Merkmal, nicht bestellung_id: Die
  -- Bestellung kann gelöscht werden, der Eintrag darf dann nicht wieder
  -- "wartet" sein.
  angebot_am     timestamptz,
  bestellung_id  uuid references bestellungen (id) on delete set null,
  angebot_verschickt_am timestamptz
);

create unique index if not exists warteliste_token_idx on warteliste (token);
-- Eine Adresse wartet je Event höchstens einmal. Nach einem verfallenen
-- Angebot darf sie sich neu eintragen — dann hinten.
create unique index if not exists warteliste_je_adresse_idx
  on warteliste (event_id, email)
  where ausgetragen_am is null and angebot_am is null;
create index if not exists warteliste_reihe_idx
  on warteliste (event_id, bestaetigt_am, id)
  where bestaetigt_am is not null and ausgetragen_am is null and angebot_am is null;

alter table warteliste enable row level security;

-- Lesen fürs Team (Backoffice). Geschrieben wird nur über die Funktionen
-- unten, mit dem Dienstschlüssel.
drop policy if exists warteliste_lesen on warteliste;
create policy warteliste_lesen on warteliste
  for select using (ist_mitarbeiter('team'));

-- ---------- Betriebswerte ----------
-- Werte, die die Datenbank selbst braucht und die nicht ins Repository
-- gehören: der Schlüssel, mit dem der Takt die Versand-Route aufruft. Ohne
-- Zugriffsregeln — lesen kann das nur der Server.
create table if not exists betrieb (
  schluessel text primary key,
  wert       text not null
);
alter table betrieb enable row level security;
revoke all on table betrieb from anon, authenticated;

insert into betrieb (schluessel, wert)
values ('adresse', 'https://lunar-events.de')
on conflict (schluessel) do nothing;

insert into betrieb (schluessel, wert)
values ('versand_schluessel',
        replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (schluessel) do nothing;

-- ---------- Ausverkauft? ----------
-- Dieselbe Regel wie wartelisteOffen() in src/lib/typen.ts: Es gibt
-- Standardphasen, und keine davon hat noch Tickets oder bekommt welche
-- (eine Phase, deren Verkauf erst beginnt, zählt als "kommt noch").
create or replace function ist_ausverkauft(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from phasen where event_id = p_event_id and art = 'standard')
     and not exists (
       select 1 from phasen p
        where p.event_id = p_event_id
          and p.art = 'standard'
          and p.aktiv
          and (p.bis is null or p.bis >= now())
          and (p.kontingent is null or p.verkauft < p.kontingent)
     );
$$;

-- ---------- Frist eines Angebots ----------
create or replace function angebot_frist(p_ab timestamptz, p_beginn timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_bis timestamptz := p_ab + interval '4 hours';
  v_ort timestamp   := v_bis at time zone 'Europe/Berlin';
begin
  -- Nachts schläft, wer auf der Liste steht.
  if extract(hour from v_ort) < 10 then
    v_bis := (date_trunc('day', v_ort) + interval '10 hours') at time zone 'Europe/Berlin';
  end if;
  return least(v_bis, p_beginn);
end;
$$;

-- ---------- Eintragen ----------
-- Antwortet immer:
--   neu              Eintrag angelegt (oder unbestätigt wiedergefunden) —
--                    Bestätigungsmail verschicken, id und token dabei
--   mail_unterwegs   unbestätigt, Mail ging vor weniger als 10 Minuten raus
--   schon_drauf      bestätigt und wartet schon
--   nicht_ausverkauft, event_zu, anzahl
create or replace function trage_in_warteliste(
  p_event_id uuid,
  p_email    text,
  p_vorname  text,
  p_anzahl   int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   events%rowtype;
  v_email   citext := lower(trim(coalesce(p_email, '')));
  v_eintrag warteliste%rowtype;
begin
  if p_anzahl is null or p_anzahl < 1 or p_anzahl > 4 then
    return jsonb_build_object('ergebnis', 'anzahl');
  end if;

  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'veroeffentlicht' or v_event.beginn < now() then
    return jsonb_build_object('ergebnis', 'event_zu');
  end if;
  if not ist_ausverkauft(p_event_id) then
    return jsonb_build_object('ergebnis', 'nicht_ausverkauft');
  end if;

  select * into v_eintrag
    from warteliste
   where event_id = p_event_id and email = v_email
     and ausgetragen_am is null and angebot_am is null
   for update;

  if found then
    if v_eintrag.bestaetigt_am is not null then
      return jsonb_build_object('ergebnis', 'schon_drauf');
    end if;
    -- Noch nicht bestätigt: Wer sich vertan hat, darf die Anzahl ändern.
    update warteliste
       set anzahl  = p_anzahl,
           vorname = coalesce(nullif(trim(coalesce(p_vorname, '')), ''), vorname)
     where id = v_eintrag.id;
    -- Nicht jedes Absenden eine neue Mail: Sonst ließe sich das Formular
    -- benutzen, um fremde Postfächer zu fluten.
    if v_eintrag.bestaetigung_verschickt_am > now() - interval '10 minutes' then
      return jsonb_build_object('ergebnis', 'mail_unterwegs');
    end if;
    return jsonb_build_object('ergebnis', 'neu', 'id', v_eintrag.id, 'token', v_eintrag.token);
  end if;

  insert into warteliste (event_id, email, vorname, anzahl)
  values (p_event_id, v_email, nullif(trim(coalesce(p_vorname, '')), ''), p_anzahl)
  returning * into v_eintrag;

  return jsonb_build_object('ergebnis', 'neu', 'id', v_eintrag.id, 'token', v_eintrag.token);
exception
  when unique_violation then
    -- Zweimal gleichzeitig abgeschickt — der andere Aufruf schickt die Mail.
    return jsonb_build_object('ergebnis', 'mail_unterwegs');
end;
$$;

-- ---------- Bestätigen ----------
-- Gibt die Event-ID zurück (damit der Server gleich verteilen kann), sonst null.
create or replace function bestaetige_warteliste(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  update warteliste
     set bestaetigt_am = coalesce(bestaetigt_am, now())
   where token = p_token
     and ausgetragen_am is null
  returning event_id into v_event;
  return v_event;
end;
$$;

-- ---------- Verteilen ----------
-- Gibt freie Plätze an die Warteliste, der Reihe nach. Ohne Event-ID für
-- alle Events (Takt), mit für eines (nach dem Speichern im Backoffice, nach
-- einem Bestätigen oder Freigeben). Gibt die Zahl neuer Angebote zurück.
create or replace function bediene_warteliste(p_event_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   events%rowtype;
  v_eintrag warteliste%rowtype;
  v_phase   record;
  v_frei    bigint;
  v_rest    int;
  v_nimm    int;
  v_auswahl jsonb;
  v_bis     timestamptz;
  v_id      uuid;
  v_anzahl  int := 0;
begin
  for v_event in
    select e.*
      from events e
     where (p_event_id is null or e.id = p_event_id)
       and e.status = 'veroeffentlicht'
       -- In der letzten Stunde vor Beginn lohnt kein Angebot mehr.
       and e.beginn > now() + interval '1 hour'
       -- Während des Presale verteilt die Warteliste nichts: Sie wäre sonst
       -- ein Zugang am Presale vorbei.
       and (e.verkauf_ab is null or e.verkauf_ab <= now())
       and exists (
         select 1 from warteliste w
          where w.event_id = e.id and w.bestaetigt_am is not null
            and w.ausgetragen_am is null and w.angebot_am is null
       )
  loop
    for v_eintrag in
      select *
        from warteliste w
       where w.event_id = v_event.id and w.bestaetigt_am is not null
         and w.ausgetragen_am is null and w.angebot_am is null
       order by w.bestaetigt_am, w.id
       for update skip locked
    loop
      -- Was ist gerade kaufbar? Dieselben Bedingungen wie in reserviere().
      select coalesce(sum(case when p.kontingent is null then 1000000
                               else greatest(p.kontingent - p.verkauft, 0) end), 0)
        into v_frei
        from phasen p
       where p.event_id = v_event.id and p.art = 'standard' and p.aktiv
         and (p.ab is null or p.ab <= now())
         and (p.bis is null or p.bis >= now());

      exit when v_frei <= 0;
      -- Wer passt, rückt vor. Der Eintrag bleibt vorne stehen.
      continue when v_frei < v_eintrag.anzahl;

      -- Die frühere Phase zuerst leeren, dann die nächste — sonst lehnt
      -- reserviere() die spätere ab (Phasenfolge, 0010).
      v_auswahl := '[]'::jsonb;
      v_rest := v_eintrag.anzahl;
      for v_phase in
        select p.id, p.kontingent, p.verkauft
          from phasen p
         where p.event_id = v_event.id and p.art = 'standard' and p.aktiv
           and (p.ab is null or p.ab <= now())
           and (p.bis is null or p.bis >= now())
         order by p.position, p.id::text
      loop
        exit when v_rest = 0;
        v_nimm := case when v_phase.kontingent is null then v_rest
                       else least(v_rest, v_phase.kontingent - v_phase.verkauft) end;
        continue when v_nimm <= 0;
        v_auswahl := v_auswahl || jsonb_build_array(
          jsonb_build_object('phase_id', v_phase.id, 'menge', v_nimm));
        v_rest := v_rest - v_nimm;
      end loop;

      -- Bis die Mail raus ist, hält das Angebot höchstens einen Tag. Die
      -- eigentliche Frist beginnt mit dem Versand (beanspruche_angebote).
      v_bis := least(now() + interval '24 hours', v_event.beginn);

      begin
        v_id := reserviere(
          p_event_id => v_event.id,
          p_auswahl  => v_auswahl,
          p_email    => v_eintrag.email::text,
          p_vorname  => v_eintrag.vorname,
          p_minuten  => greatest(ceil(extract(epoch from (v_bis - now())) / 60)::int, 1)
        );
      exception when others then
        -- Jemand war schneller, oder das Event hat sich geändert. Der
        -- nächste Takt versucht es neu.
        raise warning 'Warteliste %: %', v_eintrag.id, sqlerrm;
        exit;
      end;

      update bestellungen set reserviert_bis = v_bis where id = v_id;
      update warteliste
         set angebot_am = now(), bestellung_id = v_id
       where id = v_eintrag.id;
      v_anzahl := v_anzahl + 1;
    end loop;
  end loop;

  return v_anzahl;
end;
$$;

-- ---------- Angebote zum Versand holen ----------
-- Beansprucht unverschickte Angebote, setzt ihre Frist und gibt sie mit
-- allem zurück, was in die Mail gehört. Beanspruchen statt nur lesen: Takt
-- und Backoffice können gleichzeitig verschicken, eine Mail soll trotzdem
-- nur einmal rausgehen. Scheitert der Versand: angebot_nicht_zugestellt().
create or replace function beanspruche_angebote(
  p_event_id uuid default null,
  p_grenze   int default 50
)
returns table (
  id            uuid,
  token         text,
  email         citext,
  vorname       text,
  anzahl        int,
  reserviert_bis timestamptz,
  event_titel   text,
  event_beginn  timestamptz,
  ort           text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with faellig as (
    select w.id
      from warteliste w
      join bestellungen b on b.id = w.bestellung_id
     where (p_event_id is null or w.event_id = p_event_id)
       and w.angebot_am is not null
       and w.angebot_verschickt_am is null
       and w.ausgetragen_am is null
       and b.status = 'offen'
       and not b.vorkasse
       and (b.reserviert_bis is null or b.reserviert_bis > now())
     order by w.angebot_am, w.id
     limit greatest(coalesce(p_grenze, 50), 0)
     for update of w skip locked
  ),
  markiert as (
    update warteliste w
       set angebot_verschickt_am = now()
      from faellig
     where w.id = faellig.id
    returning w.id, w.token, w.email, w.vorname, w.anzahl, w.event_id, w.bestellung_id
  ),
  befristet as (
    update bestellungen b
       set reserviert_bis = angebot_frist(now(), e.beginn)
      from markiert m
      join events e on e.id = m.event_id
     where b.id = m.bestellung_id
    returning b.id, b.reserviert_bis
  )
  select m.id, m.token, m.email, m.vorname, m.anzahl, f.reserviert_bis,
         e.titel, e.beginn, o.name || ', ' || o.stadt
    from markiert m
    join befristet f on f.id = m.bestellung_id
    join events e on e.id = m.event_id
    join orte o on o.id = e.ort_id;
end;
$$;

-- Der Versand ist gescheitert: wieder freigeben für den nächsten Versuch und
-- die Frist zurück auf den Tag nach dem Angebot — sonst liefe die Uhr, ohne
-- dass jemand davon weiß. Länger als diesen Tag hält es nie.
create or replace function angebot_nicht_zugestellt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eintrag warteliste%rowtype;
begin
  update warteliste set angebot_verschickt_am = null
   where id = p_id and angebot_am is not null
  returning * into v_eintrag;
  if not found then
    return;
  end if;
  update bestellungen b
     set reserviert_bis = least(v_eintrag.angebot_am + interval '24 hours', e.beginn)
    from events e
   where b.id = v_eintrag.bestellung_id and e.id = b.event_id
     and b.status = 'offen' and not b.vorkasse;
end;
$$;

-- ---------- Austragen oder Angebot freigeben ----------
-- Wartet der Eintrag noch: austragen. Liegt ein Angebot vor: sofort
-- freigeben, damit der Nächste nicht stundenlang wartet. Wer schon bezahlt
-- oder per Überweisung verbindlich bestellt hat, kann hier nichts freigeben.
-- Gibt die Event-ID zurück, sonst null.
create or replace function trage_aus_warteliste(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eintrag    warteliste%rowtype;
  v_bestellung bestellungen%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into v_eintrag from warteliste where token = p_token for update;
  if not found then
    return null;
  end if;
  if v_eintrag.ausgetragen_am is not null then
    return v_eintrag.event_id;
  end if;

  if v_eintrag.angebot_am is not null and v_eintrag.bestellung_id is not null then
    select * into v_bestellung from bestellungen where id = v_eintrag.bestellung_id for update;
    if found and (v_bestellung.status = 'bezahlt'
                  or (v_bestellung.status = 'offen' and v_bestellung.vorkasse)) then
      return null;
    end if;
    if found and v_bestellung.status = 'offen' then
      update bestellungen
         set reserviert_bis = now() - interval '1 second'
       where id = v_bestellung.id;
      -- Gibt Kontingent, Fast Lane und Code-Einlösungen zurück — derselbe
      -- Weg wie bei jeder verfallenen Reservierung.
      perform raeume_reservierungen_auf();
    end if;
  end if;

  update warteliste set ausgetragen_am = now() where id = v_eintrag.id;
  return v_eintrag.event_id;
end;
$$;

-- ---------- Versand anstoßen ----------
-- Ruft die Versand-Route auf, wenn Angebote auf ihre Mail warten. pg_net
-- arbeitet im Hintergrund; eine Antwort wartet hier niemand ab.
create or replace function stosse_angebotsversand_an()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adresse    text;
  v_schluessel text;
begin
  if not exists (
    select 1
      from warteliste w
      join bestellungen b on b.id = w.bestellung_id
     where w.angebot_am is not null and w.angebot_verschickt_am is null
       and w.ausgetragen_am is null and b.status = 'offen' and not b.vorkasse
  ) then
    return false;
  end if;

  select wert into v_adresse from betrieb where schluessel = 'adresse';
  select wert into v_schluessel from betrieb where schluessel = 'versand_schluessel';
  if v_adresse is null or v_schluessel is null then
    return false;
  end if;

  perform net.http_post(
    url := v_adresse || '/api/warteliste/versand',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lunar-schluessel', v_schluessel
    ),
    timeout_milliseconds := 10000
  );
  return true;
end;
$$;

-- ---------- Der Takt ----------
-- Alle fünf Minuten: verfallene Reservierungen freigeben, das Freigewordene
-- an die Warteliste geben, Mails anstoßen. In dieser Reihenfolge und in
-- einem Lauf — zwischen Freigeben und Verteilen kommt niemand dazwischen.
-- Jeder Schritt für sich abgesichert: Scheitert das Verteilen, soll das
-- Freigeben trotzdem gelten.
create or replace function lunar_takt()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform raeume_reservierungen_auf();
  exception when others then
    raise warning 'Takt, Aufräumen: %', sqlerrm;
  end;
  begin
    perform bediene_warteliste();
  exception when others then
    raise warning 'Takt, Warteliste: %', sqlerrm;
  end;
  begin
    perform stosse_angebotsversand_an();
  exception when others then
    raise warning 'Takt, Versand: %', sqlerrm;
  end;
end;
$$;

-- ---------- Rechte (siehe 0012) ----------
revoke execute on function ist_ausverkauft(uuid) from public, anon, authenticated;
revoke execute on function angebot_frist(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function trage_in_warteliste(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function bestaetige_warteliste(text) from public, anon, authenticated;
revoke execute on function bediene_warteliste(uuid) from public, anon, authenticated;
revoke execute on function beanspruche_angebote(uuid, int) from public, anon, authenticated;
revoke execute on function angebot_nicht_zugestellt(uuid) from public, anon, authenticated;
revoke execute on function trage_aus_warteliste(text) from public, anon, authenticated;
revoke execute on function stosse_angebotsversand_an() from public, anon, authenticated;
revoke execute on function lunar_takt() from public, anon, authenticated;

grant execute on function trage_in_warteliste(uuid, text, text, int) to service_role;
grant execute on function bestaetige_warteliste(text) to service_role;
grant execute on function bediene_warteliste(uuid) to service_role;
grant execute on function beanspruche_angebote(uuid, int) to service_role;
grant execute on function angebot_nicht_zugestellt(uuid) to service_role;
grant execute on function trage_aus_warteliste(text) to service_role;
grant execute on function angebot_frist(timestamptz, timestamptz) to service_role;

commit;

-- ---------- Zeitplan ----------
-- Löst den Auftrag aus 0005 ab: Der Takt räumt auf wie bisher und kümmert
-- sich danach um die Warteliste.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lunar_reservierungen') then
    perform cron.unschedule('lunar_reservierungen');
  end if;
  if exists (select 1 from cron.job where jobname = 'lunar_takt') then
    perform cron.unschedule('lunar_takt');
  end if;
end $$;

select cron.schedule('lunar_takt', '*/5 * * * *', $$select public.lunar_takt();$$);

-- ---------- Selbstprüfung ----------
do $$
declare
  f text;
  v_weit timestamptz := timestamptz '2027-06-01 00:00+00';
begin
  -- Tagsüber: vier Stunden
  if angebot_frist(timestamptz '2026-10-01 12:00 Europe/Berlin', v_weit)
     <> timestamptz '2026-10-01 16:00 Europe/Berlin' then
    raise exception 'Frist am Tag falsch';
  end if;
  -- Abends: bis 10 Uhr am nächsten Morgen
  if angebot_frist(timestamptz '2026-10-01 22:30 Europe/Berlin', v_weit)
     <> timestamptz '2026-10-02 10:00 Europe/Berlin' then
    raise exception 'Frist in der Nacht falsch';
  end if;
  -- Früh morgens: bis 10 Uhr desselben Tages
  if angebot_frist(timestamptz '2026-10-01 05:00 Europe/Berlin', v_weit)
     <> timestamptz '2026-10-01 10:00 Europe/Berlin' then
    raise exception 'Frist am frühen Morgen falsch';
  end if;
  -- Endet nach 10 Uhr: unverändert
  if angebot_frist(timestamptz '2026-10-01 06:30 Europe/Berlin', v_weit)
     <> timestamptz '2026-10-01 10:30 Europe/Berlin' then
    raise exception 'Frist nach 10 Uhr falsch';
  end if;
  -- Nacht der Zeitumstellung (25.10.2026)
  if angebot_frist(timestamptz '2026-10-24 23:00 Europe/Berlin', v_weit)
     <> timestamptz '2026-10-25 10:00 Europe/Berlin' then
    raise exception 'Frist bei Zeitumstellung falsch';
  end if;
  -- Nie über den Beginn hinaus
  if angebot_frist(timestamptz '2026-10-01 12:00 Europe/Berlin', timestamptz '2026-10-01 14:00 Europe/Berlin')
     <> timestamptz '2026-10-01 14:00 Europe/Berlin' then
    raise exception 'Frist läuft über den Beginn';
  end if;

  foreach f in array array[
    'public.ist_ausverkauft(uuid)',
    'public.angebot_frist(timestamptz, timestamptz)',
    'public.trage_in_warteliste(uuid, text, text, int)',
    'public.bestaetige_warteliste(text)',
    'public.bediene_warteliste(uuid)',
    'public.beanspruche_angebote(uuid, int)',
    'public.angebot_nicht_zugestellt(uuid)',
    'public.trage_aus_warteliste(text)',
    'public.stosse_angebotsversand_an()',
    'public.lunar_takt()'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist öffentlich aufrufbar', f;
    end if;
  end loop;

  foreach f in array array[
    'public.trage_in_warteliste(uuid, text, text, int)',
    'public.bestaetige_warteliste(text)',
    'public.bediene_warteliste(uuid)',
    'public.beanspruche_angebote(uuid, int)',
    'public.angebot_nicht_zugestellt(uuid)',
    'public.trage_aus_warteliste(text)'
  ] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'Server kann % nicht aufrufen', f;
    end if;
  end loop;

  if not exists (select 1 from pg_class where relname = 'warteliste' and relrowsecurity) then
    raise exception 'warteliste ohne Zugriffsregeln';
  end if;
  if not exists (select 1 from pg_class where relname = 'betrieb' and relrowsecurity) then
    raise exception 'betrieb ohne Zugriffsregeln';
  end if;
  if (select count(*) from betrieb where schluessel in ('adresse', 'versand_schluessel')) <> 2 then
    raise exception 'Betriebswerte fehlen';
  end if;
  if not exists (select 1 from cron.job where jobname = 'lunar_takt' and command like '%lunar_takt%') then
    raise exception 'Der Takt ist nicht eingeplant';
  end if;
  if exists (select 1 from cron.job where jobname = 'lunar_reservierungen') then
    raise exception 'Der alte Aufräum-Auftrag läuft noch';
  end if;
  if bestaetige_warteliste('zu-kurz') is not null or trage_aus_warteliste(repeat('x', 64)) is not null then
    raise exception 'Warteliste nimmt falsche Tokens an';
  end if;
end $$;
