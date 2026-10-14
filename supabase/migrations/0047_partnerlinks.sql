-- ============================================================
-- Lunar Events — Partnerlink je Event (14.10.2026)
--
-- Geschäftspartner sollen die Bestellungen eines Events sehen, ohne ins
-- Backoffice zu kommen: Name des Käufers und Zahl der Tickets, keine
-- Mailadressen, keine Beträge (Wunsch Bobbo). Entschieden: ein Link je
-- Event, den alle Partner teilen; nur die bezahlten Online-Bestellungen.
--
-- Der Zugang ist ein langer Zufallsschlüssel in der Adresse, wie beim
-- Promoter-Link. Er steht bewusst NICHT in `events`: Die Tabelle ist für
-- alle lesbar (veröffentlichte Events), jeder könnte den Schlüssel sonst
-- über die Schnittstelle abfragen. Hier lesen und schreiben nur Admins;
-- die Partnerseite fragt mit dem Dienstschlüssel.
-- ============================================================

begin;

create table if not exists partner_links (
  event_id    uuid primary key references events (id) on delete cascade,
  -- Zwei UUIDs ohne Bindestriche: 64 Hexzeichen, wie zugangstoken (0007).
  token       text not null default
                replace(gen_random_uuid()::text, '-', '') ||
                replace(gen_random_uuid()::text, '-', ''),
  erstellt_am timestamptz not null default now()
);

create unique index if not exists partner_links_token_idx on partner_links (token);

alter table partner_links enable row level security;

drop policy if exists partner_links_admin on partner_links;
create policy partner_links_admin on partner_links
  for all
  using (ist_mitarbeiter('admin'))
  with check (ist_mitarbeiter('admin'));

-- Gäste haben hier nichts verloren, auch nicht über eine Regel.
revoke all on partner_links from anon;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not (select relrowsecurity from pg_class where relname = 'partner_links') then
    raise exception 'partner_links ohne Zugriffsregeln';
  end if;
  if has_table_privilege('anon', 'partner_links', 'select') then
    raise exception 'anon darf partner_links lesen';
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'events' and column_name like '%token%') then
    raise exception 'Ein Token in events wäre öffentlich lesbar';
  end if;
  if length((select column_default from information_schema.columns
              where table_name = 'partner_links' and column_name = 'token')) < 10 then
    raise exception 'partner_links.token ohne Zufallswert';
  end if;
end $$;

commit;
