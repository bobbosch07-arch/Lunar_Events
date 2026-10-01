-- ============================================================
-- Lunar Events — Newsletter verschicken (01.10.2026)
--
-- Seit 0037 sammelt der Verteiler bestätigte Adressen, aber nichts konnte
-- an sie gehen: Es gab keinen Ort, eine Mail zu schreiben. Jetzt im
-- Backoffice unter „Newsletter".
--
-- Eine Ausgabe ist eine geschriebene Mail. Je Empfänger wird vermerkt, dass
-- sie rausging — so kann ein abgebrochener Versand (Tageslimit beim
-- Anbieter: 300 Mails im kostenlosen Brevo-Tarif) fortgesetzt werden,
-- ohne dass jemand dieselbe Mail zweimal bekommt.
--
-- Die Zustellungen hängen an der Adresse im Verteiler: Wird eine Adresse
-- entfernt, verschwindet auch ihr Versandvermerk.
-- ============================================================

begin;

create table if not exists newsletter_ausgaben (
  id               uuid primary key default gen_random_uuid(),
  betreff          text not null check (length(betreff) between 1 and 150),
  text             text not null check (length(text) between 1 and 10000),
  event_id         uuid references events(id) on delete set null,
  erstellt_von     uuid references auth.users(id) on delete set null,
  erstellt_am      timestamptz not null default now(),
  abgeschlossen_am timestamptz
);

create index if not exists newsletter_ausgaben_erstellt_idx
  on newsletter_ausgaben (erstellt_am desc);

create table if not exists newsletter_zustellungen (
  ausgabe_id    uuid not null references newsletter_ausgaben(id) on delete cascade,
  email         citext not null references newsletter(email) on delete cascade,
  verschickt_am timestamptz not null default now(),
  primary key (ausgabe_id, email)
);

create index if not exists newsletter_zustellungen_email_idx
  on newsletter_zustellungen (email);

-- Lesen darf das Backoffice, geschrieben wird nur über den Dienstschlüssel
-- nach der Rollenprüfung in der Server-Aktion (wie bei presale_einladungen).
alter table newsletter_ausgaben     enable row level security;
alter table newsletter_zustellungen enable row level security;
revoke all on table newsletter_ausgaben     from anon;
revoke all on table newsletter_zustellungen from anon;

drop policy if exists newsletter_ausgaben_lesen on newsletter_ausgaben;
create policy newsletter_ausgaben_lesen on newsletter_ausgaben
  for select using (ist_mitarbeiter('admin'));

drop policy if exists newsletter_zustellungen_lesen on newsletter_zustellungen;
create policy newsletter_zustellungen_lesen on newsletter_zustellungen
  for select using (ist_mitarbeiter('admin'));

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_email text := 'selbsttest-0039-' || gen_random_uuid() || '@example.invalid';
  v_ausgabe uuid;
begin
  insert into newsletter (email, bestaetigt) values (v_email, true);
  insert into newsletter_ausgaben (betreff, text) values ('Selbsttest', 'Selbsttest')
    returning id into v_ausgabe;
  insert into newsletter_zustellungen (ausgabe_id, email) values (v_ausgabe, v_email);

  begin
    insert into newsletter_zustellungen (ausgabe_id, email) values (v_ausgabe, v_email);
    raise exception 'Doppelte Zustellung angenommen';
  exception when unique_violation then null;
  end;

  -- Adresse weg → Vermerk weg.
  delete from newsletter where email = v_email;
  if exists (select 1 from newsletter_zustellungen where ausgabe_id = v_ausgabe) then
    raise exception 'Zustellung überlebt das Entfernen der Adresse';
  end if;
  delete from newsletter_ausgaben where id = v_ausgabe;

  if has_table_privilege('anon', 'newsletter_ausgaben', 'select') then
    raise exception 'anon darf newsletter_ausgaben lesen';
  end if;
end $$;
