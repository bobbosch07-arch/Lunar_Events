-- ============================================================
-- Lunar Events — Presale
--
-- Entscheidungen (Fragebogen 16.09.2026, Rückfragen 17.09.2026):
--
--   * Je Event zwei Zeitpunkte: presale_ab und verkauf_ab. Dazwischen
--     kauft nur, wer Zugang hat; vorher niemand, danach alle. Ohne
--     verkauf_ab läuft der Verkauf wie bisher.
--   * Zugang über Codes: Ein Rabattcode bekommt das Häkchen
--     "öffnet den Presale" und darf dann auch 0 € Rabatt haben. Der
--     Newsletter-Link ist der Link mit Code. Obergrenze, Zählung je Code
--     und Promoter kommen damit von den Rabattcodes mit.
--   * Frühere Gäste bekommen eine persönliche Einladung per Mail. Gekauft
--     werden kann damit nur unter der eingeladenen Adresse.
--   * Normale Besucher sehen die Phasen mit Preisen und einen Hinweis auf
--     den Verkaufsstart.
--
-- Werbung an Bestandskunden (§ 7 Abs. 3 UWG): erlaubt nur, wenn beim Kauf
-- darauf hingewiesen wurde und jede Mail einen Abmeldelink trägt.
-- bestellungen.werbehinweis hält fest, dass die Kasse den Hinweis gezeigt
-- hat — der Server setzt es, sobald die neue Kasse live ist. Alte
-- Bestellungen bleiben false und werden nie eingeladen. Abmelden setzt
-- kunden.keine_werbung.
-- ============================================================

begin;

-- ---------- Events ----------
alter table events
  add column if not exists presale_ab timestamptz,
  add column if not exists verkauf_ab timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_presale_gueltig') then
    alter table events add constraint events_presale_gueltig check (
      presale_ab is null
      or (verkauf_ab is not null and presale_ab < verkauf_ab)
    );
  end if;
end $$;

-- ---------- Codes ----------
alter table rabattcodes
  add column if not exists oeffnet_presale boolean not null default false;

-- 0 € Rabatt ist nur für Presale-Codes sinnvoll — ein normaler Code ohne
-- Rabatt täte gar nichts.
alter table rabattcodes drop constraint if exists rabattcodes_wert;
alter table rabattcodes add constraint rabattcodes_wert check (
  wert >= 0
  and (wert > 0 or oeffnet_presale)
  and (art <> 'prozent' or wert <= 100)
);

-- ---------- Kunden und Bestellungen ----------
alter table kunden
  add column if not exists keine_werbung        boolean not null default false,
  add column if not exists werbung_abgemeldet_am timestamptz;

alter table bestellungen
  add column if not exists werbehinweis boolean not null default false;

-- ---------- Einladungen ----------
create table if not exists presale_einladungen (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events (id) on delete cascade,
  kunde_id      uuid not null references kunden (id) on delete cascade,
  token         text not null default
                  replace(gen_random_uuid()::text, '-', '') ||
                  replace(gen_random_uuid()::text, '-', ''),
  erstellt_am   timestamptz not null default now(),
  -- null = angelegt, aber noch nicht verschickt (z. B. Tageslimit erreicht)
  verschickt_am timestamptz
);

create unique index if not exists presale_einladungen_token_idx on presale_einladungen (token);
create unique index if not exists presale_einladungen_je_gast_idx
  on presale_einladungen (event_id, kunde_id);

alter table bestellungen
  add column if not exists einladung_id uuid references presale_einladungen (id) on delete set null;

alter table presale_einladungen enable row level security;

drop policy if exists presale_einladungen_lesen on presale_einladungen;
create policy presale_einladungen_lesen on presale_einladungen
  for select using (ist_mitarbeiter('team'));

drop policy if exists presale_einladungen_pflegen on presale_einladungen;
create policy presale_einladungen_pflegen on presale_einladungen
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

-- ---------- Reservierung ----------
drop function if exists reserviere(uuid, jsonb, text, text, text, text, int, int, text);

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
  p_einladung  text default null
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
  if coalesce(p_fastlane, 0) < 0 then
    raise exception 'MENGE_UNGUELTIG';
  end if;

  -- ---------- Verkaufsstart und Presale (neu in 0019) ----------
  -- Vor dem öffentlichen Verkauf kauft nur, wer Zugang hat: eine Einladung
  -- für genau dieses Event und genau diese Adresse, oder ein Code, der den
  -- Presale öffnet. Ob der Code sonst noch gilt (Obergrenze, einmal je
  -- Person), prüft der Code-Abschnitt weiter unten.
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
      -- Die Einladung gilt nur für die Adresse, an die sie ging. Sonst
      -- reichte ein weitergeleiteter Link für beliebig viele Käufer.
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

  -- Kunde anlegen oder wiederfinden
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

    -- Die Sperre ist der ganze Punkt: ab hier kann niemand sonst dieselbe
    -- Phase veraendern, bis diese Transaktion fertig ist.
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
    if not v_phase.aktiv
       or (v_phase.ab is not null and v_phase.ab > now())
       or (v_phase.bis is not null and v_phase.bis < now()) then
      raise exception 'PHASE_NICHT_KAUFBAR';
    end if;

    -- Seit 0010: Hat eine frühere Standardphase noch Tickets, ist diese
    -- hier noch nicht dran.
    if exists (
      select 1
        from phasen vor
       where vor.event_id = p_event_id
         and vor.art = 'standard'
         and vor.aktiv
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
    -- Dieselbe Sperre wie bei den Phasen, diesmal auf das Event: zwei
    -- Käufer greifen sonst gleichzeitig nach dem letzten Platz.
    select * into v_event from events where id = p_event_id for update;

    if not v_event.fastlane_aktiv then
      raise exception 'FASTLANE_NICHT_VERFUEGBAR';
    end if;
    -- Mehr Upgrades als Tickets ergäben Fast Lane ohne Person dazu.
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

  if v_summe = 0 and v_gebuehr = 0
     and not exists (select 1 from bestellpositionen
                      where bestellung_id = v_bestellung_id) then
    raise exception 'AUSWAHL_LEER';
  end if;

  -- ---------- Rabattcode (neu in 0016) ----------
  if v_code_text <> '' then
    -- Gesperrt wie ein Kontingent: Zwei Gäste greifen sonst gleichzeitig
    -- nach der letzten Einlösung.
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

    -- Einmal je Person heißt: je E-Mail-Adresse. Gezählt werden bezahlte
    -- Bestellungen und Überweisungen, die noch ausstehen. Eine liegen
    -- gelassene Kartenreservierung zählt nicht — sonst sperrte sich jeder
    -- selbst aus, der in der Kasse einmal zurückgeht und neu anfängt.
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


-- ---------- Vorschau: gilt ein Code? ----------
-- Unverändert bis auf ein Feld: Die Kasse muss wissen, ob der Code den
-- Presale öffnet, um "Presale-Zugang" statt "− 0 €" zu zeigen.
create or replace function pruefe_rabattcode(
  p_code     text,
  p_event_id uuid,
  p_auswahl  jsonb,
  p_fastlane int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_text    text := upper(trim(coalesce(p_code, '')));
  v_code    rabattcodes%rowtype;
  v_event   events%rowtype;
  v_phase   phasen%rowtype;
  v_eintrag jsonb;
  v_menge   int;
  v_posten  jsonb := '[]'::jsonb;
  v_summe   int := 0;
  v_gebuehr int := 0;
  v_alle    int := 0;
  v_rabatt  int;
  v_anzahl  int;
begin
  if v_text = '' then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;

  select * into v_code from rabattcodes where code = v_text;
  if not found or not v_code.aktiv then
    return jsonb_build_object('ergebnis', 'unbekannt');
  end if;
  if v_code.gueltig_ab is not null and v_code.gueltig_ab > now() then
    return jsonb_build_object('ergebnis', 'noch_nicht', 'ab', v_code.gueltig_ab);
  end if;
  if v_code.gueltig_bis is not null and v_code.gueltig_bis < now() then
    return jsonb_build_object('ergebnis', 'abgelaufen');
  end if;
  if v_code.event_id is not null and v_code.event_id <> p_event_id then
    return jsonb_build_object('ergebnis', 'anderes_event');
  end if;
  if v_code.max_tickets is not null and v_code.eingeloest >= v_code.max_tickets then
    return jsonb_build_object('ergebnis', 'aufgebraucht');
  end if;

  for v_eintrag in select * from jsonb_array_elements(coalesce(p_auswahl, '[]'::jsonb)) loop
    v_menge := (v_eintrag ->> 'menge')::int;
    continue when v_menge is null or v_menge <= 0;

    select * into v_phase
      from phasen
     where id = (v_eintrag ->> 'phase_id')::uuid
       and event_id = p_event_id;
    continue when not found or v_phase.art = 'vip';

    v_posten := v_posten || jsonb_build_array(jsonb_build_object(
      'phase_id', v_phase.id, 'menge', v_menge, 'einzelpreis_cent', v_phase.preis_cent));
    v_summe   := v_summe   + v_phase.preis_cent   * v_menge;
    v_gebuehr := v_gebuehr + v_phase.gebuehr_cent * v_menge;
    v_alle    := v_alle    + v_menge;
  end loop;

  select r.rabatt, r.anzahl into v_rabatt, v_anzahl from code_rabatt(v_code, v_posten) r;

  if v_anzahl = 0 then
    return jsonb_build_object('ergebnis', 'passt_nicht');
  end if;

  if coalesce(p_fastlane, 0) > 0 then
    select * into v_event from events where id = p_event_id;
    if v_event.fastlane_aktiv then
      v_summe := v_summe + v_event.fastlane_preis_cent * p_fastlane;
    end if;
  end if;

  return jsonb_build_object(
    'ergebnis', 'ok',
    'code', v_code.code,
    'art', v_code.art,
    'wert', v_code.wert,
    'rabatt_cent', rabatt_ohne_kleinstbetrag(v_rabatt, v_summe + v_gebuehr),
    'tickets', v_anzahl,
    'tickets_gesamt', v_alle,
    'oeffnet_presale', v_code.oeffnet_presale
  );
end;
$$;

-- ---------- Wie steht der Verkauf, und hat dieser Besuch Zugang? ----------
-- Für Eventseite und Kasse. Antwortet immer, wirft nie.
--   verkauf: "offen" | "presale" | "bald"
--   zugang (nur bei presale): "einladung" (mit email) | "code" | null
create or replace function pruefe_presale_zugang(
  p_event_id  uuid,
  p_code      text default null,
  p_einladung text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_text  text := upper(trim(coalesce(p_code, '')));
  v_email citext;
  v_code  rabattcodes%rowtype;
begin
  select * into v_event from events where id = p_event_id;
  if not found then
    return jsonb_build_object('verkauf', 'offen');
  end if;

  if v_event.verkauf_ab is null or v_event.verkauf_ab <= now() then
    return jsonb_build_object('verkauf', 'offen');
  end if;

  if v_event.presale_ab is null or v_event.presale_ab > now() then
    return jsonb_build_object(
      'verkauf', 'bald',
      'presale_ab', v_event.presale_ab,
      'verkauf_ab', v_event.verkauf_ab
    );
  end if;

  if nullif(trim(coalesce(p_einladung, '')), '') is not null then
    select k.email into v_email
      from presale_einladungen e
      join kunden k on k.id = e.kunde_id
     where e.token = trim(p_einladung)
       and e.event_id = p_event_id;
    if v_email is not null then
      return jsonb_build_object(
        'verkauf', 'presale', 'verkauf_ab', v_event.verkauf_ab,
        'zugang', 'einladung', 'email', v_email
      );
    end if;
  end if;

  if v_text <> '' then
    select * into v_code from rabattcodes
     where code = v_text
       and aktiv
       and oeffnet_presale
       and (event_id is null or event_id = p_event_id)
       and (gueltig_ab is null or gueltig_ab <= now())
       and (gueltig_bis is null or gueltig_bis >= now());
    if found then
      if v_code.max_tickets is not null and v_code.eingeloest >= v_code.max_tickets then
        return jsonb_build_object(
          'verkauf', 'presale', 'verkauf_ab', v_event.verkauf_ab,
          'zugang', null, 'grund', 'aufgebraucht'
        );
      end if;
      return jsonb_build_object(
        'verkauf', 'presale', 'verkauf_ab', v_event.verkauf_ab,
        'zugang', 'code', 'code', v_code.code
      );
    end if;
  end if;

  return jsonb_build_object(
    'verkauf', 'presale', 'verkauf_ab', v_event.verkauf_ab,
    'zugang', null, 'grund', case when v_text <> '' then 'unbekannt' end
  );
end;
$$;

-- ---------- Einladungen vorbereiten ----------
-- Legt für alle früheren Gäste, die noch keine haben, eine Einladung an und
-- gibt bis zu p_grenze noch nicht verschickte zurück. Früherer Gast heißt:
-- eine bezahlte Bestellung für ein anderes Event, bei der die Kasse den
-- Werbehinweis gezeigt hat, nicht abgemeldet — und noch kein Ticket für
-- dieses Event.
create or replace function bereite_presale_einladungen_vor(p_event_id uuid, p_grenze int default 100)
returns table (id uuid, token text, email citext, vorname text)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into presale_einladungen (event_id, kunde_id)
  select distinct p_event_id, k.id
    from kunden k
    join bestellungen b on b.kunde_id = k.id
   where b.status = 'bezahlt'
     and b.werbehinweis
     and b.event_id <> p_event_id
     and not k.keine_werbung
     and k.email is not null
     and not exists (select 1 from bestellungen x
                      where x.kunde_id = k.id and x.event_id = p_event_id
                        and x.status = 'bezahlt')
  on conflict (event_id, kunde_id) do nothing;

  return query
  select e.id, e.token, k.email, k.vorname
    from presale_einladungen e
    join kunden k on k.id = e.kunde_id
   where e.event_id = p_event_id
     and e.verschickt_am is null
     and not k.keine_werbung
   order by e.erstellt_am, e.id
   limit greatest(coalesce(p_grenze, 100), 0);
end;
$$;

-- ---------- Stand der Einladungen ----------
create or replace function presale_einladung_stand(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    -- Wer eine Einladung bekäme, wenn jetzt gesendet würde (inkl. schon angelegter)
    'moeglich', (
      select count(distinct k.id)
        from kunden k
        join bestellungen b on b.kunde_id = k.id
       where b.status = 'bezahlt' and b.werbehinweis and b.event_id <> p_event_id
         and not k.keine_werbung and k.email is not null
         and not exists (select 1 from bestellungen x
                          where x.kunde_id = k.id and x.event_id = p_event_id
                            and x.status = 'bezahlt')
    ),
    'verschickt', (select count(*) from presale_einladungen e
                    where e.event_id = p_event_id and e.verschickt_am is not null),
    'gekauft', (select count(distinct b.einladung_id) from bestellungen b
                 join presale_einladungen e on e.id = b.einladung_id
                where e.event_id = p_event_id and b.status = 'bezahlt'),
    'abgemeldet', (select count(*) from kunden where keine_werbung)
  );
$$;

-- ---------- Abmelden ----------
-- Über den Token der Einladung, damit der Link in der Mail ohne Anmeldung
-- funktioniert. Wirkt für alle künftigen Einladungen dieser Person.
create or replace function melde_werbung_ab(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kunde uuid;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  select kunde_id into v_kunde from presale_einladungen where token = p_token;
  if v_kunde is null then
    return false;
  end if;
  update kunden
     set keine_werbung = true,
         werbung_abgemeldet_am = coalesce(werbung_abgemeldet_am, now())
   where id = v_kunde;
  return true;
end;
$$;

-- ---------- Rechte (siehe 0012) ----------
revoke execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text, text)
  from public, anon, authenticated;
grant execute on function reserviere(uuid, jsonb, text, text, text, text, int, int, text, text)
  to service_role;

revoke execute on function pruefe_presale_zugang(uuid, text, text) from public, anon, authenticated;
grant execute on function pruefe_presale_zugang(uuid, text, text) to service_role;
revoke execute on function bereite_presale_einladungen_vor(uuid, int) from public, anon, authenticated;
grant execute on function bereite_presale_einladungen_vor(uuid, int) to service_role;
revoke execute on function presale_einladung_stand(uuid) from public, anon, authenticated;
grant execute on function presale_einladung_stand(uuid) to service_role;
revoke execute on function melde_werbung_ab(text) from public, anon, authenticated;
grant execute on function melde_werbung_ab(text) to service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  f text;
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reserviere') <> 1 then
    raise exception 'reserviere() gibt es nicht genau einmal';
  end if;
  if not exists (select 1 from pg_proc where proname = 'reserviere'
                  and prosrc like '%PRESALE_ZUGANG_FEHLT%'
                  and prosrc like '%CODE_SCHON_GENUTZT%'
                  and prosrc like '%FASTLANE_AUSVERKAUFT%'
                  and prosrc like '%vor.position < v_phase.position%'
                  and prosrc like '%einladung_id%') then
    raise exception 'reserviere() hat Presale, Code, Fast Lane oder Phasenfolge verloren';
  end if;
  if not exists (select 1 from pg_proc where proname = 'pruefe_rabattcode'
                  and prosrc like '%oeffnet_presale%') then
    raise exception 'pruefe_rabattcode() meldet oeffnet_presale nicht';
  end if;

  foreach f in array array[
    'public.reserviere(uuid, jsonb, text, text, text, text, int, int, text, text)',
    'public.pruefe_presale_zugang(uuid, text, text)',
    'public.bereite_presale_einladungen_vor(uuid, int)',
    'public.presale_einladung_stand(uuid)',
    'public.melde_werbung_ab(text)'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% ist öffentlich aufrufbar', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'Server kann % nicht aufrufen', f;
    end if;
  end loop;

  if not exists (select 1 from pg_class where relname = 'presale_einladungen' and relrowsecurity) then
    raise exception 'presale_einladungen ohne Zugriffsregeln';
  end if;
  if melde_werbung_ab('zu-kurz') or melde_werbung_ab(repeat('x', 64)) then
    raise exception 'melde_werbung_ab nimmt falsche Tokens an';
  end if;
end $$;
