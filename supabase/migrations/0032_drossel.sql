-- ============================================================
-- Lunar Events — Drossel für öffentliche Aktionen
--
-- Gemeldet am 19.09.2026 von einem Kunden: Über die Konsole ließen sich
-- beliebig viele Bestellungen reservieren. Die Obergrenze von 20 Tickets
-- stand nur in der Oberfläche. Wer das ganze Kontingent reserviert, lässt
-- ein Event 15 Minuten lang ausverkauft aussehen, und das beliebig oft.
-- Dasselbe galt für alles, was eine Mail auslöst (Anmeldelink, Newsletter,
-- Warteliste, VIP): Brevo schickt 300 Mails am Tag, danach kommen auch die
-- Ticketmails nicht mehr an.
--
-- Die Drossel zählt je Schlüssel (Aktion + gehashte IP oder Mailadresse)
-- innerhalb eines Zeitfensters. Die IP wird nie im Klartext gespeichert:
-- Der Server bildet vorher einen HMAC mit einem Geheimnis, und nach einem
-- Tag ist die Zeile weg.
-- ============================================================

begin;

create table if not exists drossel (
  id         bigint generated always as identity primary key,
  schluessel text not null,
  gewicht    int not null default 1 check (gewicht > 0),
  zeit       timestamptz not null default now()
);

create index if not exists drossel_schluessel_zeit_idx on drossel (schluessel, zeit);
create index if not exists drossel_zeit_idx on drossel (zeit);

-- Keine Regeln: Lesen und Schreiben nur über die Funktion unten, und die
-- nur mit dem Dienstschlüssel.
alter table drossel enable row level security;
revoke all on table drossel from anon, authenticated;

-- Liefert true und zählt mit, solange die Grenze nicht überschritten
-- würde. Sonst false, ohne zu zählen: Wer abgewiesen wird, verlängert
-- seine Sperre nicht selbst.
create or replace function drossel(
  p_schluessel  text,
  p_fenster_sek int,
  p_grenze      int,
  p_gewicht     int default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summe int;
begin
  if p_gewicht < 1 or p_grenze < 1 or p_fenster_sek < 1 then
    raise exception 'DROSSEL_UNGUELTIG';
  end if;

  -- Gleichzeitige Anfragen mit demselben Schlüssel nacheinander, sonst
  -- kämen zwei parallele Anfragen beide knapp unter der Grenze durch.
  perform pg_advisory_xact_lock(hashtext('drossel:' || p_schluessel));

  select coalesce(sum(gewicht), 0) into v_summe
    from drossel
   where schluessel = p_schluessel
     and zeit > now() - make_interval(secs => p_fenster_sek);

  if v_summe + p_gewicht > p_grenze then
    return false;
  end if;

  insert into drossel (schluessel, gewicht) values (p_schluessel, p_gewicht);

  -- Aufräumen nebenbei, ohne eigenen Zeitplan
  if random() < 0.02 then
    delete from drossel where zeit < now() - interval '1 day';
  end if;

  return true;
end;
$$;

revoke execute on function drossel(text, int, int, int) from public, anon, authenticated;
grant execute on function drossel(text, int, int, int) to service_role;

-- ---------- Löschfristen ----------
-- Die Datenschutzerklärung nennt Fristen; bis hierher hielt sie nur der
-- gute Wille ein. Täglich um 4 Uhr (UTC):
--   * VIP-Anfragen ohne Vertrag nach sechs Monaten. Bestätigte bleiben
--     (Beleg), ebenso Anfragen, an denen VIP-Tickets hängen.
--   * Wartelisten-Einträge 30 Tage nach dem Event.
--   * Drossel-Zeilen nach einem Tag.
create or replace function loesche_alte_daten()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vip int;
  v_warte int;
  v_drossel int;
begin
  delete from vip_anfragen a
   where a.erstellt_am < now() - interval '6 months'
     and a.status <> 'bestaetigt'
     and not exists (select 1 from gaeste g where g.vip_anfrage_id = a.id);
  get diagnostics v_vip = row_count;

  delete from warteliste w
   using events e
   where e.id = w.event_id
     and coalesce(e.ende, e.beginn) < now() - interval '30 days';
  get diagnostics v_warte = row_count;

  delete from drossel where zeit < now() - interval '1 day';
  get diagnostics v_drossel = row_count;

  return jsonb_build_object('vip', v_vip, 'warteliste', v_warte, 'drossel', v_drossel);
end;
$$;

revoke execute on function loesche_alte_daten() from public, anon, authenticated;
grant execute on function loesche_alte_daten() to service_role;

select cron.unschedule('lunar_loeschfristen')
 where exists (select 1 from cron.job where jobname = 'lunar_loeschfristen');
select cron.schedule('lunar_loeschfristen', '0 4 * * *', $$select public.loesche_alte_daten();$$);

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_k text := 'selbstpruefung:' || gen_random_uuid();
begin
  if not drossel(v_k, 60, 3, 2) then raise exception 'drossel: erster Aufruf abgewiesen'; end if;
  if not drossel(v_k, 60, 3, 1) then raise exception 'drossel: zweiter Aufruf abgewiesen'; end if;
  if drossel(v_k, 60, 3, 1) then raise exception 'drossel: Grenze nicht eingehalten'; end if;
  delete from drossel where schluessel = v_k;

  if has_function_privilege('anon', 'drossel(text, int, int, int)', 'execute')
     or has_function_privilege('authenticated', 'drossel(text, int, int, int)', 'execute') then
    raise exception 'drossel ist von außen aufrufbar';
  end if;
  if has_table_privilege('anon', 'drossel', 'select') then
    raise exception 'drossel ist von außen lesbar';
  end if;
  if not exists (select 1 from cron.job where jobname = 'lunar_loeschfristen') then
    raise exception 'Löschlauf ist nicht eingeplant';
  end if;
  if has_function_privilege('anon', 'loesche_alte_daten()', 'execute') then
    raise exception 'loesche_alte_daten ist von außen aufrufbar';
  end if;
end $$;
