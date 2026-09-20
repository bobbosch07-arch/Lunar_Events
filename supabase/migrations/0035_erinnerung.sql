-- ============================================================
-- Lunar Events — Erinnerungsmail einen Tag vorher (C6)
--
-- Wie der Warteliste-Versand: Der Takt (lunar_takt, alle 5 Minuten) merkt,
-- wenn ein Event in die 24-Stunden-Fenster rueckt und noch bezahlte
-- Bestellungen ohne Erinnerung hat, und ruft dafuer eine Route ueber pg_net
-- (stosse_erinnerung_an). Die Route verschickt je Bestellung eine Mail und
-- vermerkt das (erinnerung_am) — so geht sie genau einmal raus.
--
-- Kein Vorausplanen wie in einer App: Es gibt keinen Client, der es tut.
-- Der Takt ist der einzige verlaessliche Ausloeser.
-- ============================================================

begin;

alter table bestellungen
  add column if not exists erinnerung_am timestamptz;

create index if not exists bestellungen_erinnerung_offen_idx
  on bestellungen (event_id)
  where status = 'bezahlt' and erinnerung_am is null;

-- Ruft die Erinnerungs-Route, wenn ein Event in den naechsten 24 Stunden
-- beginnt und noch bezahlte Bestellungen ohne Erinnerung hat. pg_net
-- arbeitet im Hintergrund; niemand wartet hier auf die Antwort.
create or replace function stosse_erinnerung_an()
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
      from bestellungen b
      join events e on e.id = b.event_id
     where b.status = 'bezahlt'
       and b.erinnerung_am is null
       and e.status = 'veroeffentlicht'
       and e.beginn > now()
       and e.beginn <= now() + interval '24 hours'
  ) then
    return false;
  end if;

  select wert into v_adresse from betrieb where schluessel = 'adresse';
  select wert into v_schluessel from betrieb where schluessel = 'versand_schluessel';
  if v_adresse is null or v_schluessel is null then
    return false;
  end if;

  perform net.http_post(
    url := v_adresse || '/api/erinnerung/versand',
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

revoke execute on function stosse_erinnerung_an() from public, anon, authenticated;
grant execute on function stosse_erinnerung_an() to service_role;

-- Der Takt bekommt einen vierten Schritt. Wortgleich zu 0020, nur die
-- Erinnerung kommt dazu — jeder Schritt fuer sich abgesichert.
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
  begin
    perform stosse_erinnerung_an();
  exception when others then
    raise warning 'Takt, Erinnerung: %', sqlerrm;
  end;
end;
$$;

revoke execute on function lunar_takt() from public, anon, authenticated;

commit;

-- ---------- Selbstpruefung ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'bestellungen' and column_name = 'erinnerung_am') then
    raise exception 'bestellungen.erinnerung_am fehlt';
  end if;
  if not exists (select 1 from pg_proc where proname = 'stosse_erinnerung_an') then
    raise exception 'stosse_erinnerung_an fehlt';
  end if;
  -- Der Takt ruft die Erinnerung jetzt mit.
  if not exists (
    select 1 from pg_proc
     where proname = 'lunar_takt'
       and pg_get_functiondef(oid) like '%stosse_erinnerung_an%'
  ) then
    raise exception 'lunar_takt ruft stosse_erinnerung_an nicht';
  end if;
end $$;
