-- ============================================================
-- Lunar Events — Garderobe
--
-- Entscheidungen (Rückfragen 17.09.2026, Chat 18.09.2026):
--
--   * „Vorab online bezahlen" und „QR-Code statt Papiermarke" — beides.
--   * Preis je Event, dazu ein freiwilliges Kontingent (die Garderobe hat
--     nur so viele Bügel). Gekauft wird je Stück — Jacke, Tasche —, höchstens
--     zwei je Ticket.
--   * Kaufbar in der Kasse als Zusatz (nie vorangekreuzt) und auf der
--     Ticketseite nachzubuchen, bis zum Ende des Abends. Wer nichts gebucht
--     hat, zahlt vor Ort bar mit Papiermarke wie bisher — das läuft nicht
--     über uns.
--   * Am Tresen: Abgabe = QR scannen und die Bügelnummer eintippen.
--     Abholung = scannen, die Nummer steht groß da, die Marke ist erledigt.
--   * Neue Rolle "garderobe": darf Marken scannen, sonst nichts.
--
-- Eine Marke ist kein Ticket. Sie hat einen eigenen QR-Code ("G-…") und
-- hängt an der Bestellung, nicht an einem Ticket: Tickets dürfen frei
-- weitergegeben werden, und bei vier Tickets mit zwei Jacken wäre sonst
-- unklar, welches Ticket die Jacke "hat".
--
-- Das Kontingent läuft wie Fast Lane (0011) durch alle Wege: reserviere()
-- und reserviere_garderobe() buchen unter Sperre, raeume_reservierungen_auf()
-- gibt zurück, bestaetige_zahlung() stellt die Marken aus.
-- ============================================================

begin;

-- ---------- Rolle ----------
alter table mitarbeiter drop constraint if exists mitarbeiter_rolle_check;
alter table mitarbeiter add constraint mitarbeiter_rolle_check check (
  rolle in ('admin', 'kasse', 'einlass', 'bar', 'security', 'runner', 'toiletten', 'garderobe')
);

-- Die Regel an schichten.rolle stand ohne Namen in 0023. Statt den
-- vergebenen Namen zu raten, wird jede Rollen-Regel dort ersetzt.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'schichten'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%toiletten%'
  loop
    execute format('alter table schichten drop constraint %I', v_name);
  end loop;
end $$;
alter table schichten add constraint schichten_rolle_check check (
  rolle in ('admin', 'kasse', 'einlass', 'bar', 'security', 'runner', 'toiletten', 'garderobe')
);

-- Neue Stufe "garderobe": wer Tickets scannen darf, darf auch an der
-- Garderobe aushelfen — dazu die Garderobe selbst.
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
            when 'garderobe' then m.rolle in ('admin', 'kasse', 'einlass', 'bar', 'garderobe')
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

-- ---------- Angebot am Event ----------
alter table events
  add column if not exists garderobe_aktiv      boolean not null default false,
  add column if not exists garderobe_preis_cent int     not null default 0,
  -- null = unbegrenzt
  add column if not exists garderobe_kontingent int,
  add column if not exists garderobe_verkauft   int     not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_garderobe_gueltig') then
    alter table events add constraint events_garderobe_gueltig check (
      garderobe_preis_cent >= 0
      and garderobe_verkauft >= 0
      and (garderobe_kontingent is null
           or (garderobe_kontingent >= 0 and garderobe_verkauft <= garderobe_kontingent))
      -- Unter 50 Cent bucht Stripe nicht ab, und umsonst gibt es nichts zu
      -- verkaufen.
      and (not garderobe_aktiv or garderobe_preis_cent >= 50)
    );
  end if;
end $$;

-- ---------- An der Bestellung ----------
-- Menge und Preis werden kopiert wie bei Fast Lane: Die Bestellung muss
-- stimmen, auch wenn der Preis am Event später geändert wird.
-- nachbuchung_zu: Garderobe, die auf der Ticketseite nachgebucht wurde, ist
-- eine eigene Bestellung (eigene Zahlung), gehört aber zu dieser.
alter table bestellungen
  add column if not exists garderobe_menge      int not null default 0 check (garderobe_menge >= 0),
  add column if not exists garderobe_preis_cent int not null default 0 check (garderobe_preis_cent >= 0),
  add column if not exists nachbuchung_zu       uuid references bestellungen (id) on delete set null;

create index if not exists bestellungen_nachbuchung_idx
  on bestellungen (nachbuchung_zu) where nachbuchung_zu is not null;

-- ---------- Marken ----------
create table if not exists garderobe_marken (
  id            uuid primary key default gen_random_uuid(),
  bestellung_id uuid not null references bestellungen (id) on delete cascade,
  event_id      uuid not null references events (id) on delete restrict,
  -- Der Wert im QR-Code: "G-" + 20 Zeichen aus dem Ticketalphabet.
  code          text not null unique,
  status        text not null default 'gueltig' check (status in ('gueltig', 'storniert')),
  -- Die Nummer des Bügels, getippt bei der Abgabe.
  nummer        text check (nummer is null or length(nummer) between 1 and 12),
  abgegeben_am  timestamptz,
  abgegeben_von uuid references auth.users (id) on delete set null,
  abgeholt_am   timestamptz,
  abgeholt_von  uuid references auth.users (id) on delete set null,
  erstellt_am   timestamptz not null default now(),
  constraint garderobe_marken_ablauf check (
    (nummer is null) = (abgegeben_am is null)
    and (abgeholt_am is null or abgegeben_am is not null)
  )
);

create index if not exists garderobe_marken_event_idx on garderobe_marken (event_id);
create index if not exists garderobe_marken_bestellung_idx on garderobe_marken (bestellung_id);

-- An einem Bügel hängt immer nur eine Jacke. Die Datenbank ist der letzte
-- Ort, an dem ein Vertipper oder zwei Geräte gleichzeitig auffallen.
create unique index if not exists garderobe_marken_buegel_idx
  on garderobe_marken (event_id, nummer)
  where abgegeben_am is not null and abgeholt_am is null;

alter table garderobe_marken enable row level security;

-- Lesen: Personal mit Garderoben-Recht und der Kunde selbst. Geschrieben
-- wird nur über die Funktionen unten.
drop policy if exists garderobe_marken_lesen on garderobe_marken;
create policy garderobe_marken_lesen on garderobe_marken
  for select using (
    ist_mitarbeiter('garderobe')
    or exists (
      select 1 from bestellungen b
       where b.id = garderobe_marken.bestellung_id
         and ist_eigener_kunde(b.kunde_id)
    )
  );

-- ---------- Kleine Regeln an einer Stelle ----------
-- Höchstens zwei Stück je Ticket: Jacke und Tasche. Steht auch in
-- src/lib/typen.ts (GARDEROBE_JE_TICKET).
create or replace function garderobe_je_ticket()
returns int
language sql
immutable
as $$ select 2 $$;

-- Nachbuchen geht bis zum Ende des Events, ohne eingetragenes Ende bis
-- sechs Stunden nach Beginn. Steht auch in typen.ts (garderobeBis).
create or replace function garderobe_bis(p_beginn timestamptz, p_ende timestamptz)
returns timestamptz
language sql
immutable
as $$ select coalesce(p_ende, p_beginn + interval '6 hours') $$;

-- ---------- Reservierung ----------
-- Neuer Parameter p_garderobe: wie viele Stück. Die alte Fassung wird
-- entfernt, sonst gäbe es zwei Funktionen gleichen Namens.
drop function if exists reserviere(uuid, jsonb, text, text, text, text, int, int, text, text);

create or replace function reserviere(
  p_event_id   uuid,
  p_auswahl    jsonb,
  p_email      text,
  p_vorname    text default null,
  p_nachname   text default null,
  p_telefon    text default null,
  p_minuten    int default 15,
  p_fastlane   int default 0,
  p_code       text default null,
  p_einladung  text default null,
  p_garderobe  int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunde_id      uuid;
  v_bestellung_id uuid;
  v_eintrag       jsonb;
  v_phase         phasen%rowtype;
  v_menge         int;
  v_summe         int := 0;
  v_gebuehr       int := 0;
  v_tickets       int := 0;
  v_event         events%rowtype;
  v_code_text     text := upper(trim(coalesce(p_code, '')));
  v_code          rabattcodes%rowtype;
  v_posten        jsonb;
  v_code_rabatt   int := 0;
  v_code_tickets  int := 0;
  v_einladung_id  uuid;
  v_eingeladen    citext;
begin
  select * into v_event from events where id = p_event_id;
  if not found or v_event.status <> 'veroeffentlicht' then
    raise exception 'EVENT_NICHT_VERFUEGBAR';
  end if;
  if v_event.beginn < now() then
    raise exception 'EVENT_VORBEI';
  end if;
  if coalesce(p_fastlane, 0) < 0 or coalesce(p_garderobe, 0) < 0 then
    raise exception 'MENGE_UNGUELTIG';
  end if;

  -- ---------- Verkaufsstart und Presale (0019) ----------
  if v_event.verkauf_ab is not null and v_event.verkauf_ab > now() then
    if v_event.presale_ab is null or v_event.presale_ab > now() then
      raise exception 'VERKAUF_NOCH_NICHT';
    end if;

    if nullif(trim(coalesce(p_einladung, '')), '') is not null then
      select e.id, k.email into v_einladung_id, v_eingeladen
        from presale_einladungen e
        join kunden k on k.id = e.kunde_id
       where e.token = trim(p_einladung)
         and e.event_id = p_event_id;
      if v_einladung_id is not null and v_eingeladen <> p_email::citext then
        v_einladung_id := null;
        if not exists (
          select 1 from rabattcodes r
           where r.code = v_code_text and r.aktiv and r.oeffnet_presale
        ) then
          raise exception 'PRESALE_ANDERE_ADRESSE';
        end if;
      end if;
    end if;

    if v_einladung_id is null and not exists (
      select 1 from rabattcodes r
       where r.code = v_code_text
         and r.aktiv
         and r.oeffnet_presale
         and (r.event_id is null or r.event_id = p_event_id)
         and (r.gueltig_ab is null or r.gueltig_ab <= now())
         and (r.gueltig_bis is null or r.gueltig_bis >= now())
    ) then
      raise exception 'PRESALE_ZUGANG_FEHLT';
    end if;
  end if;

  insert into kunden (email, vorname, nachname, telefon)
       values (p_email, p_vorname, p_nachname, p_telefon)
  on conflict (email) do update
     set vorname  = coalesce(excluded.vorname, kunden.vorname),
         nachname = coalesce(excluded.nachname, kunden.nachname),
         telefon  = coalesce(excluded.telefon, kunden.telefon)
  returning id into v_kunde_id;

  insert into bestellungen (nummer, event_id, kunde_id, status, reserviert_bis)
       values (neue_bestellnummer(), p_event_id, v_kunde_id, 'offen',
               now() + make_interval(mins => p_minuten))
  returning id into v_bestellung_id;

  for v_eintrag in select * from jsonb_array_elements(p_auswahl) loop
    v_menge := (v_eintrag ->> 'menge')::int;
    if v_menge is null or v_menge <= 0 then
      raise exception 'MENGE_UNGUELTIG';
    end if;

    select * into v_phase
      from phasen
     where id = (v_eintrag ->> 'phase_id')::uuid
       and event_id = p_event_id
       for update;

    if not found then
      raise exception 'PHASE_UNBEKANNT';
    end if;
    if v_phase.art = 'vip' then
      raise exception 'VIP_NUR_AUF_ANFRAGE';
    end if;
    -- Was für die Tür gedacht ist, gibt es online nicht (0025).
    if v_phase.abendkasse then
      raise exception 'PHASE_NUR_ABENDKASSE';
    end if;
    if not v_phase.aktiv
       or (v_phase.ab is not null and v_phase.ab > now())
       or (v_phase.bis is not null and v_phase.bis < now()) then
      raise exception 'PHASE_NICHT_KAUFBAR';
    end if;

    -- Phasenfolge (0010) — Türphasen zählen dabei nicht mit, sonst
    -- blockierte eine Abendkasse mit Restkarten den Online-Verkauf.
    if exists (
      select 1
        from phasen vor
       where vor.event_id = p_event_id
         and vor.art = 'standard'
         and vor.aktiv
         and not vor.abendkasse
         and (vor.position < v_phase.position
              or (vor.position = v_phase.position and vor.id::text < v_phase.id::text))
         and (vor.ab is null or vor.ab <= now())
         and (vor.bis is null or vor.bis >= now())
         and (vor.kontingent is null or vor.verkauft < vor.kontingent)
    ) then
      raise exception 'PHASE_NICHT_KAUFBAR';
    end if;

    if v_phase.kontingent is not null
       and v_phase.verkauft + v_menge > v_phase.kontingent then
      raise exception 'NICHT_GENUG_TICKETS:%:%',
        v_phase.name, greatest(v_phase.kontingent - v_phase.verkauft, 0);
    end if;

    update phasen set verkauft = verkauft + v_menge where id = v_phase.id;

    insert into bestellpositionen
      (bestellung_id, phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)
    values
      (v_bestellung_id, v_phase.id, v_phase.name, v_menge,
       v_phase.preis_cent, v_phase.gebuehr_cent);

    v_summe   := v_summe   + v_phase.preis_cent * v_menge;
    v_gebuehr := v_gebuehr + v_phase.gebuehr_cent * v_menge;
    v_tickets := v_tickets + v_menge;
  end loop;

  -- ---------- Fast Lane (0011) ----------
  if coalesce(p_fastlane, 0) > 0 then
    select * into v_event from events where id = p_event_id for update;

    if not v_event.fastlane_aktiv then
      raise exception 'FASTLANE_NICHT_VERFUEGBAR';
    end if;
    if p_fastlane > v_tickets then
      raise exception 'FASTLANE_MENGE';
    end if;
    if v_event.fastlane_kontingent is not null
       and v_event.fastlane_verkauft + p_fastlane > v_event.fastlane_kontingent then
      raise exception 'FASTLANE_AUSVERKAUFT:%',
        greatest(v_event.fastlane_kontingent - v_event.fastlane_verkauft, 0);
    end if;

    update events
       set fastlane_verkauft = fastlane_verkauft + p_fastlane
     where id = p_event_id;

    update bestellungen
       set fastlane_menge      = p_fastlane,
           fastlane_preis_cent = v_event.fastlane_preis_cent
     where id = v_bestellung_id;

    v_summe := v_summe + v_event.fastlane_preis_cent * p_fastlane;
  end if;

  -- ---------- Garderobe (0027) ----------
  -- Wie Fast Lane: unter Sperre am Event gebucht, Preis in die Bestellung
  -- kopiert. Je Ticket höchstens zwei Stück (Jacke und Tasche).
  if coalesce(p_garderobe, 0) > 0 then
    select * into v_event from events where id = p_event_id for update;

    if not v_event.garderobe_aktiv then
      raise exception 'GARDEROBE_NICHT_VERFUEGBAR';
    end if;
    if p_garderobe > garderobe_je_ticket() * v_tickets then
      raise exception 'GARDEROBE_MENGE:%', garderobe_je_ticket() * v_tickets;
    end if;
    if v_event.garderobe_kontingent is not null
       and v_event.garderobe_verkauft + p_garderobe > v_event.garderobe_kontingent then
      raise exception 'GARDEROBE_AUSVERKAUFT:%',
        greatest(v_event.garderobe_kontingent - v_event.garderobe_verkauft, 0);
    end if;

    update events
       set garderobe_verkauft = garderobe_verkauft + p_garderobe
     where id = p_event_id;

    update bestellungen
       set garderobe_menge      = p_garderobe,
           garderobe_preis_cent = v_event.garderobe_preis_cent
     where id = v_bestellung_id;

    v_summe := v_summe + v_event.garderobe_preis_cent * p_garderobe;
  end if;

  if v_summe = 0 and v_gebuehr = 0
     and not exists (select 1 from bestellpositionen
                      where bestellung_id = v_bestellung_id) then
    raise exception 'AUSWAHL_LEER';
  end if;

  -- ---------- Rabattcode (0016) ----------
  if v_code_text <> '' then
    select * into v_code from rabattcodes where code = v_code_text for update;

    if not found or not v_code.aktiv then
      raise exception 'CODE_UNBEKANNT';
    end if;
    if v_code.gueltig_ab is not null and v_code.gueltig_ab > now() then
      raise exception 'CODE_NOCH_NICHT';
    end if;
    if v_code.gueltig_bis is not null and v_code.gueltig_bis < now() then
      raise exception 'CODE_ABGELAUFEN';
    end if;
    if v_code.event_id is not null and v_code.event_id <> p_event_id then
      raise exception 'CODE_ANDERES_EVENT';
    end if;
    if v_code.max_tickets is not null and v_code.eingeloest >= v_code.max_tickets then
      raise exception 'CODE_AUFGEBRAUCHT';
    end if;

    if v_code.einmal_pro_person and exists (
      select 1 from bestellungen b
       where b.rabattcode_id = v_code.id
         and b.kunde_id = v_kunde_id
         and b.id <> v_bestellung_id
         and (b.status = 'bezahlt' or (b.status = 'offen' and b.vorkasse))
    ) then
      raise exception 'CODE_SCHON_GENUTZT';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'phase_id', phase_id, 'menge', menge, 'einzelpreis_cent', einzelpreis_cent)),
             '[]'::jsonb)
      into v_posten
      from bestellpositionen
     where bestellung_id = v_bestellung_id;

    select r.rabatt, r.anzahl into v_code_rabatt, v_code_tickets
      from code_rabatt(v_code, v_posten) r;

    if v_code_tickets = 0 then
      raise exception 'CODE_PASST_NICHT';
    end if;

    v_code_rabatt := rabatt_ohne_kleinstbetrag(v_code_rabatt, v_summe + v_gebuehr);

    update rabattcodes
       set eingeloest = eingeloest + v_code_tickets
     where id = v_code.id;
  end if;

  update bestellungen
     set summe_cent       = v_summe,
         gebuehr_cent     = v_gebuehr,
         gesamt_cent      = v_summe + v_gebuehr - v_code_rabatt,
         rabattcode_id    = case when v_code_tickets > 0 then v_code.id end,
         rabattcode       = case when v_code_tickets > 0 then v_code.code end,
         code_rabatt_cent = v_code_rabatt,
         code_tickets     = v_code_tickets,
         einladung_id     = v_einladung_id
   where id = v_bestellung_id;

  return v_bestellung_id;
end;
$$;

-- ---------- Bezahlung bestätigen ----------
-- Unverändert bis auf die Marken am Schluss.
create or replace function bestaetige_zahlung(
  p_bestellung_id uuid,
  p_zahlungsart   zahlungsart,
  p_referenz      text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_position   bestellpositionen%rowtype;
  v_i          int;
  v_anzahl     int := 0;
begin
  select * into v_bestellung
    from bestellungen where id = p_bestellung_id for update;

  if not found then
    raise exception 'BESTELLUNG_UNBEKANNT';
  end if;

  -- Zahlungsanbieter melden denselben Vorgang gern mehrfach. Zweimal
  -- Tickets auszustellen waere schlimmer als eine verpasste Meldung.
  if v_bestellung.status = 'bezahlt' then
    return (select count(*)::int from tickets where bestellung_id = p_bestellung_id);
  end if;
  if v_bestellung.status <> 'offen' then
    raise exception 'BESTELLUNG_NICHT_OFFEN:%', v_bestellung.status;
  end if;

  for v_position in
    select * from bestellpositionen where bestellung_id = p_bestellung_id
  loop
    for v_i in 1..v_position.menge loop
      insert into tickets
        (bestellung_id, event_id, phase_id, phase_name, art, code, gast_name)
      values
        (p_bestellung_id, v_bestellung.event_id, v_position.phase_id,
         v_position.phase_name,
         (select art from phasen where id = v_position.phase_id),
         neuer_ticketcode(),
         null);
      v_anzahl := v_anzahl + 1;
    end loop;
  end loop;

  if v_bestellung.fastlane_menge > 0 then
    update tickets
       set fastlane = true
     where id in (
       select id from tickets
        where bestellung_id = p_bestellung_id
        order by erstellt_am, id
        limit v_bestellung.fastlane_menge
     );
  end if;

  -- Garderobenmarken (0027): eine je Stück, mit eigenem Code. Das "G-"
  -- kommt im Ticketalphabet nicht vor — so erkennt jeder Scanner, dass er
  -- eine Marke vor sich hat und kein Ticket.
  for v_i in 1..v_bestellung.garderobe_menge loop
    insert into garderobe_marken (bestellung_id, event_id, code)
    values (p_bestellung_id, v_bestellung.event_id, 'G-' || neuer_ticketcode());
  end loop;

  update bestellungen
     set status         = 'bezahlt',
         zahlungsart    = p_zahlungsart,
         zahlung_ref    = p_referenz,
         bezahlt_am     = now(),
         reserviert_bis = null
   where id = p_bestellung_id;

  return v_anzahl;
end;
$$;

-- ---------- Abgelaufene Reservierungen ----------
-- Gibt jetzt auch Garderobenplätze zurück.
create or replace function raeume_reservierungen_auf()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bestellung bestellungen%rowtype;
  v_position   bestellpositionen%rowtype;
  v_anzahl     int := 0;
begin
  for v_bestellung in
    select * from bestellungen
     where status = 'offen'
       and reserviert_bis is not null
       and reserviert_bis < now()
     for update skip locked
  loop
    for v_position in
      select * from bestellpositionen where bestellung_id = v_bestellung.id
    loop
      update phasen
         set verkauft = greatest(verkauft - v_position.menge, 0)
       where id = v_position.phase_id;
    end loop;

    if v_bestellung.fastlane_menge > 0 then
      update events
         set fastlane_verkauft = greatest(fastlane_verkauft - v_bestellung.fastlane_menge, 0)
       where id = v_bestellung.event_id;
    end if;

    if v_bestellung.garderobe_menge > 0 then
      update events
         set garderobe_verkauft = greatest(garderobe_verkauft - v_bestellung.garderobe_menge, 0)
       where id = v_bestellung.event_id;
    end if;

    if v_bestellung.rabattcode_id is not null and v_bestellung.code_tickets > 0 then
      update rabattcodes
         set eingeloest = greatest(eingeloest - v_bestellung.code_tickets, 0)
       where id = v_bestellung.rabattcode_id;
    end if;

    update bestellungen set status = 'abgelaufen', reserviert_bis = null
     where id = v_bestellung.id;
    v_anzahl := v_anzahl + 1;
  end loop;

  return v_anzahl;
end;
$$;

-- ---------- Nachbuchen auf der Ticketseite ----------
-- Legt eine eigene Bestellung an (eigene Zahlung, eigene Frist), die über
-- nachbuchung_zu an der ursprünglichen hängt. Der Nachweis ist der
-- Zugangstoken aus dem Ticketlink — wer ihn hat, hat auch die Tickets.
-- Nur für service_role: Die Anwendung ruft, nachdem sie den Link geprüft hat.
create or replace function reserviere_garderobe(
  p_token   text,
  p_anzahl  int,
  p_minuten int default 15
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orig    bestellungen%rowtype;
  v_event   events%rowtype;
  v_tickets int;
  v_schon   int;
  v_id      uuid;
begin
  if p_anzahl is null or p_anzahl < 1 then
    raise exception 'MENGE_UNGUELTIG';
  end if;

  select * into v_orig from bestellungen
   where zugangstoken = p_token and nachbuchung_zu is null;
  if not found or v_orig.status <> 'bezahlt' then
    raise exception 'BESTELLUNG_UNBEKANNT';
  end if;

  select * into v_event from events where id = v_orig.event_id for update;
  if v_event.status <> 'veroeffentlicht' or not v_event.garderobe_aktiv then
    raise exception 'GARDEROBE_NICHT_VERFUEGBAR';
  end if;
  if now() >= garderobe_bis(v_event.beginn, v_event.ende) then
    raise exception 'EVENT_VORBEI';
  end if;

  -- Zwei je Ticket, über alle Buchungen dieser Bestellung hinweg. Laufende
  -- Reservierungen zählen mit, sonst ginge die Grenze mit zwei offenen Tabs
  -- verloren.
  select count(*) into v_tickets
    from tickets where bestellung_id = v_orig.id and status <> 'storniert';
  select coalesce(sum(b.garderobe_menge), 0) into v_schon
    from bestellungen b
   where (b.id = v_orig.id or b.nachbuchung_zu = v_orig.id)
     and (b.status = 'bezahlt'
          or (b.status = 'offen' and (b.reserviert_bis is null or b.reserviert_bis > now())));

  if v_schon + p_anzahl > garderobe_je_ticket() * v_tickets then
    raise exception 'GARDEROBE_MENGE:%', greatest(garderobe_je_ticket() * v_tickets - v_schon, 0);
  end if;
  if v_event.garderobe_kontingent is not null
     and v_event.garderobe_verkauft + p_anzahl > v_event.garderobe_kontingent then
    raise exception 'GARDEROBE_AUSVERKAUFT:%',
      greatest(v_event.garderobe_kontingent - v_event.garderobe_verkauft, 0);
  end if;

  update events
     set garderobe_verkauft = garderobe_verkauft + p_anzahl
   where id = v_event.id;

  insert into bestellungen
    (nummer, event_id, kunde_id, status, reserviert_bis,
     summe_cent, gebuehr_cent, gesamt_cent,
     garderobe_menge, garderobe_preis_cent, nachbuchung_zu)
  values
    (neue_bestellnummer(), v_event.id, v_orig.kunde_id, 'offen'::bestell_status,
     now() + make_interval(mins => p_minuten),
     v_event.garderobe_preis_cent * p_anzahl, 0, v_event.garderobe_preis_cent * p_anzahl,
     p_anzahl, v_event.garderobe_preis_cent, v_orig.id)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------- Am Tresen ----------
-- Alle Funktionen hier antworten immer mit jsonb und werfen nicht — wie
-- entwerte_ticket(): Am Tresen steht jemand und wartet.
--   zustand: offen (bezahlt, nicht abgegeben) | haengt | abgeholt | storniert

-- Wer zu einer Marke gehört: der Name aus der Bestellung. Die Garderobe
-- sieht nur den Namen, keine Adresse.
create or replace function garderobe_name(p_bestellung_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(coalesce(k.vorname, '') || ' ' || coalesce(k.nachname, '')), '')
    from bestellungen b join kunden k on k.id = b.kunde_id
   where b.id = p_bestellung_id
$$;

create or replace function garderobe_zustand(m garderobe_marken)
returns text
language sql
immutable
as $$
  select case
    when m.status = 'storniert' then 'storniert'
    when m.abgeholt_am is not null then 'abgeholt'
    when m.abgegeben_am is not null then 'haengt'
    else 'offen'
  end
$$;

-- Ein Scan. Hängt die Jacke schon, ist das die Abholung: Die Nummer wird
-- gezeigt und die Marke ist erledigt — ein Scan, kein zweiter Klick.
-- Ausnahme: in den ersten drei Minuten nach der Abgabe. Wer dieselbe Marke
-- gleich nochmal vor die Kamera hält, gibt sonst die Jacke aus, die gerade
-- aufgehängt wurde.
--   ergebnis: abgabe | abholung | gerade_abgegeben | schon_abgeholt |
--             storniert | anderes_event | ticket | unbekannt | keine_berechtigung
create or replace function garderobe_scan(p_code text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text := upper(trim(coalesce(p_code, '')));
  v_marke garderobe_marken%rowtype;
  v_name  text;
begin
  if not ist_mitarbeiter('garderobe') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_marke from garderobe_marken where code = v_code for update;
  if not found then
    if exists (select 1 from tickets where code = v_code) then
      return jsonb_build_object('ergebnis', 'ticket');
    end if;
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  if v_marke.event_id <> p_event_id then
    return jsonb_build_object('ergebnis', 'anderes_event',
      'event', (select titel from events where id = v_marke.event_id));
  end if;

  v_name := garderobe_name(v_marke.bestellung_id);

  if v_marke.status = 'storniert' then
    return jsonb_build_object('ergebnis', 'storniert', 'id', v_marke.id, 'name', v_name);
  end if;

  if v_marke.abgegeben_am is null then
    return jsonb_build_object('ergebnis', 'abgabe', 'id', v_marke.id, 'name', v_name);
  end if;

  if v_marke.abgeholt_am is not null then
    return jsonb_build_object('ergebnis', 'schon_abgeholt', 'id', v_marke.id, 'name', v_name,
      'nummer', v_marke.nummer, 'zeitpunkt', v_marke.abgeholt_am);
  end if;

  if v_marke.abgegeben_am > now() - interval '3 minutes' then
    return jsonb_build_object('ergebnis', 'gerade_abgegeben', 'id', v_marke.id, 'name', v_name,
      'nummer', v_marke.nummer, 'zeitpunkt', v_marke.abgegeben_am);
  end if;

  update garderobe_marken
     set abgeholt_am = now(), abgeholt_von = auth.uid()
   where id = v_marke.id;

  return jsonb_build_object('ergebnis', 'abholung', 'id', v_marke.id, 'name', v_name,
    'nummer', v_marke.nummer);
end;
$$;

-- Abgabe: die Bügelnummer an die Marke.
--   ergebnis: ok | nummer | nummer_belegt | schon_abgegeben | storniert |
--             unbekannt | keine_berechtigung
create or replace function garderobe_abgeben(p_id uuid, p_nummer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nummer text := upper(trim(coalesce(p_nummer, '')));
  v_marke  garderobe_marken%rowtype;
begin
  if not ist_mitarbeiter('garderobe') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;
  if length(v_nummer) < 1 or length(v_nummer) > 12 then
    return jsonb_build_object('ergebnis', 'nummer');
  end if;

  select * into v_marke from garderobe_marken where id = p_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_marke.status = 'storniert' then
    return jsonb_build_object('ergebnis', 'storniert');
  end if;
  if v_marke.abgegeben_am is not null then
    return jsonb_build_object('ergebnis', 'schon_abgegeben', 'nummer', v_marke.nummer,
      'zustand', garderobe_zustand(v_marke));
  end if;
  if exists (
    select 1 from garderobe_marken
     where event_id = v_marke.event_id and nummer = v_nummer
       and abgegeben_am is not null and abgeholt_am is null
  ) then
    return jsonb_build_object('ergebnis', 'nummer_belegt', 'nummer', v_nummer);
  end if;

  update garderobe_marken
     set nummer = v_nummer, abgegeben_am = now(), abgegeben_von = auth.uid()
   where id = v_marke.id;

  return jsonb_build_object('ergebnis', 'ok', 'nummer', v_nummer,
    'name', garderobe_name(v_marke.bestellung_id));
exception
  -- Zwei Geräte, derselbe Bügel, dieselbe Sekunde: Der Index hält es auf.
  when unique_violation then
    return jsonb_build_object('ergebnis', 'nummer_belegt', 'nummer', v_nummer);
end;
$$;

-- Abholung ohne Scan — aus der Namenssuche, oder "trotzdem ausgeben" nach
-- gerade_abgegeben.
--   ergebnis: abholung | schon_abgeholt | nicht_abgegeben | storniert |
--             unbekannt | keine_berechtigung
create or replace function garderobe_ausgeben(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marke garderobe_marken%rowtype;
begin
  if not ist_mitarbeiter('garderobe') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_marke from garderobe_marken where id = p_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_marke.status = 'storniert' then
    return jsonb_build_object('ergebnis', 'storniert');
  end if;
  if v_marke.abgegeben_am is null then
    return jsonb_build_object('ergebnis', 'nicht_abgegeben');
  end if;
  if v_marke.abgeholt_am is not null then
    return jsonb_build_object('ergebnis', 'schon_abgeholt', 'nummer', v_marke.nummer,
      'zeitpunkt', v_marke.abgeholt_am);
  end if;

  update garderobe_marken
     set abgeholt_am = now(), abgeholt_von = auth.uid()
   where id = v_marke.id;

  return jsonb_build_object('ergebnis', 'abholung', 'nummer', v_marke.nummer,
    'name', garderobe_name(v_marke.bestellung_id));
end;
$$;

-- Einen Schritt zurück: abgeholt → hängt wieder, hängt → noch nicht
-- abgegeben. Für Fehlgriffe am Tresen.
--   ergebnis: ok (mit zustand) | nummer_belegt | nichts | unbekannt | keine_berechtigung
create or replace function garderobe_rueckgaengig(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marke garderobe_marken%rowtype;
begin
  if not ist_mitarbeiter('garderobe') then
    return jsonb_build_object('ergebnis', 'keine_berechtigung');
  end if;

  select * into v_marke from garderobe_marken where id = p_id for update;
  if not found then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  if v_marke.abgeholt_am is not null then
    -- Der Bügel kann inzwischen an jemand anderen gegangen sein.
    if exists (
      select 1 from garderobe_marken
       where event_id = v_marke.event_id and nummer = v_marke.nummer and id <> v_marke.id
         and abgegeben_am is not null and abgeholt_am is null
    ) then
      return jsonb_build_object('ergebnis', 'nummer_belegt', 'nummer', v_marke.nummer);
    end if;
    update garderobe_marken set abgeholt_am = null, abgeholt_von = null where id = v_marke.id;
    return jsonb_build_object('ergebnis', 'ok', 'zustand', 'haengt', 'nummer', v_marke.nummer);
  end if;

  if v_marke.abgegeben_am is not null then
    update garderobe_marken
       set nummer = null, abgegeben_am = null, abgegeben_von = null
     where id = v_marke.id;
    return jsonb_build_object('ergebnis', 'ok', 'zustand', 'offen');
  end if;

  return jsonb_build_object('ergebnis', 'nichts');
end;
$$;

-- Alle Marken eines Events, für die Namenssuche und den Betrieb ohne Netz.
-- Statt der Codes nur Prüfsummen (wie beim Einlass-Scanner): Das Gerät
-- erkennt eine Marke, aber aus einem verlorenen Telefon lassen sich keine
-- herstellen. Ohne Rolle eine leere Liste.
create or replace function garderobe_liste(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not ist_mitarbeiter('garderobe') then '[]'::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'summe', left(encode(sha256(convert_to(m.code, 'UTF8')), 'hex'), 16),
               'name', garderobe_name(m.bestellung_id),
               'bestellnummer', b.nummer,
               'nummer', m.nummer,
               'zustand', garderobe_zustand(m))
             order by m.erstellt_am, m.id)
        from garderobe_marken m
        join bestellungen b on b.id = m.bestellung_id
       where m.event_id = p_event_id
    ), '[]'::jsonb)
  end;
$$;

-- ---------- Rechte (siehe 0012) ----------
revoke execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text, text, int)
  from public, anon, authenticated;
grant execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text, text, int)
  to service_role;

revoke execute on function reserviere_garderobe(text, int, int) from public, anon, authenticated;
grant execute on function reserviere_garderobe(text, int, int) to service_role;

-- Hilfen: laufen nur innerhalb der Funktionen oben.
revoke execute on function garderobe_je_ticket() from public, anon, authenticated;
revoke execute on function garderobe_bis(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function garderobe_name(uuid) from public, anon, authenticated;
revoke execute on function garderobe_zustand(garderobe_marken) from public, anon, authenticated;

-- Am Tresen: über die Sitzung, die Funktion prüft die Rolle selbst.
revoke execute on function garderobe_scan(text, uuid) from public, anon;
revoke execute on function garderobe_abgeben(uuid, text) from public, anon;
revoke execute on function garderobe_ausgeben(uuid) from public, anon;
revoke execute on function garderobe_rueckgaengig(uuid) from public, anon;
revoke execute on function garderobe_liste(uuid) from public, anon;
grant execute on function garderobe_scan(text, uuid) to authenticated, service_role;
grant execute on function garderobe_abgeben(uuid, text) to authenticated, service_role;
grant execute on function garderobe_ausgeben(uuid) to authenticated, service_role;
grant execute on function garderobe_rueckgaengig(uuid) to authenticated, service_role;
grant execute on function garderobe_liste(uuid) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  f text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'events' and column_name = 'garderobe_verkauft')
     or not exists (select 1 from information_schema.columns
                     where table_name = 'bestellungen' and column_name = 'nachbuchung_zu') then
    raise exception 'Garderoben-Spalten fehlen';
  end if;
  if not exists (select 1 from pg_class where relname = 'garderobe_marken' and relrowsecurity) then
    raise exception 'garderobe_marken ohne Zugriffsregeln';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'garderobe_marken_buegel_idx') then
    raise exception 'Ein Bügel könnte doppelt vergeben werden';
  end if;

  -- Die Rolle muss überall ankommen, wo Rollen geprüft werden.
  if not exists (select 1 from pg_constraint where conname = 'mitarbeiter_rolle_check'
                  and pg_get_constraintdef(oid) like '%garderobe%')
     or not exists (select 1 from pg_constraint where conname = 'schichten_rolle_check'
                     and pg_get_constraintdef(oid) like '%garderobe%')
     or (select count(*) from pg_constraint
          where conrelid = 'schichten'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) like '%toiletten%') <> 1 then
    raise exception 'Rolle garderobe fehlt an mitarbeiter oder schichten';
  end if;
  if not exists (select 1 from pg_proc where proname = 'ist_mitarbeiter'
                  and prosrc like '%when ''garderobe''%'
                  and prosrc like '%aal2%'
                  and prosrc like '%amr%') then
    raise exception 'ist_mitarbeiter() kennt garderobe nicht oder hat etwas verloren';
  end if;

  -- Nichts von vorher verloren?
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reserviere') <> 1 then
    raise exception 'reserviere() gibt es nicht genau einmal';
  end if;
  if not exists (select 1 from pg_proc where proname = 'reserviere'
                  and prosrc like '%GARDEROBE_AUSVERKAUFT%'
                  and prosrc like '%PHASE_NUR_ABENDKASSE%'
                  and prosrc like '%not vor.abendkasse%'
                  and prosrc like '%PRESALE_ZUGANG_FEHLT%'
                  and prosrc like '%CODE_SCHON_GENUTZT%'
                  and prosrc like '%FASTLANE_AUSVERKAUFT%') then
    raise exception 'reserviere() hat etwas verloren';
  end if;
  if not exists (select 1 from pg_proc where proname = 'bestaetige_zahlung'
                  and prosrc like '%garderobe_marken%'
                  and prosrc like '%fastlane = true%') then
    raise exception 'bestaetige_zahlung() stellt keine Marken aus';
  end if;
  if not exists (select 1 from pg_proc where proname = 'raeume_reservierungen_auf'
                  and prosrc like '%garderobe_verkauft%'
                  and prosrc like '%fastlane_verkauft%'
                  and prosrc like '%eingeloest%') then
    raise exception 'raeume_reservierungen_auf() gibt etwas nicht zurück';
  end if;

  -- Ohne Rolle geht am Tresen nichts, und nichts wirft.
  if garderobe_scan('G-X', gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or garderobe_abgeben(gen_random_uuid(), '1') ->> 'ergebnis' <> 'keine_berechtigung'
     or garderobe_ausgeben(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or garderobe_rueckgaengig(gen_random_uuid()) ->> 'ergebnis' <> 'keine_berechtigung'
     or garderobe_liste(gen_random_uuid()) <> '[]'::jsonb then
    raise exception 'Garderobe lässt ohne Rolle etwas zu';
  end if;

  foreach f in array array[
    'public.garderobe_scan(text, uuid)',
    'public.garderobe_abgeben(uuid, text)',
    'public.garderobe_ausgeben(uuid)',
    'public.garderobe_rueckgaengig(uuid)',
    'public.garderobe_liste(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% ist ohne Anmeldung aufrufbar', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist für das Personal nicht aufrufbar', f;
    end if;
  end loop;

  foreach f in array array[
    'public.reserviere(uuid, jsonb, text, text, text, text, int, int, text, text, int)',
    'public.reserviere_garderobe(text, int, int)',
    'public.garderobe_name(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist offen', f;
    end if;
  end loop;

  if garderobe_bis('2026-10-01 23:00+02', null) <> '2026-10-02 05:00+02'::timestamptz then
    raise exception 'garderobe_bis rechnet falsch';
  end if;
end $$;
