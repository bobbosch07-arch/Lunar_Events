-- ============================================================
-- Lunar Events — Zugriffsregeln
--
-- Grundhaltung: alles zu, dann einzeln aufmachen. Was oeffentlich sein
-- muss (veroeffentlichte Events und ihre Preise), ist oeffentlich. Alles
-- mit Personenbezug gehoert der Person, die es angeht, plus dem Team.
--
-- Gastbestellungen ohne Konto koennen ueber diese Regeln nicht gelesen
-- werden — das ist Absicht. Die Bestaetigungsseite laeuft serverseitig
-- mit dem Dienstschluessel und der Bestellnummer aus der Sitzung.
-- ============================================================

begin;

alter table mitarbeiter       enable row level security;
alter table orte              enable row level security;
alter table events            enable row level security;
alter table phasen            enable row level security;
alter table kunden            enable row level security;
alter table bestellungen      enable row level security;
alter table bestellpositionen enable row level security;
alter table tickets           enable row level security;
alter table vip_anfragen      enable row level security;
alter table newsletter        enable row level security;

-- Hilfsfunktion: gehoert dieser Kunde zur angemeldeten Person?
create or replace function ist_eigener_kunde(p_kunde_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from kunden k
     where k.id = p_kunde_id
       and k.user_id = auth.uid()
  );
$$;

-- ---------- Mitarbeiter ----------
drop policy if exists mitarbeiter_lesen on mitarbeiter;
create policy mitarbeiter_lesen on mitarbeiter
  for select using (user_id = auth.uid() or ist_mitarbeiter('admin'));

drop policy if exists mitarbeiter_pflegen on mitarbeiter;
create policy mitarbeiter_pflegen on mitarbeiter
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

-- ---------- Orte ----------
drop policy if exists orte_lesen on orte;
create policy orte_lesen on orte for select using (true);

drop policy if exists orte_pflegen on orte;
create policy orte_pflegen on orte
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

-- ---------- Events ----------
-- Entwuerfe bleiben unsichtbar, bis sie veroeffentlicht sind. Abgesagte
-- Events bleiben sichtbar — wer ein Ticket hat, muss die Absage finden.
drop policy if exists events_lesen on events;
create policy events_lesen on events
  for select using (
    status in ('veroeffentlicht', 'abgesagt') or ist_mitarbeiter('team')
  );

drop policy if exists events_pflegen on events;
create policy events_pflegen on events
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

-- ---------- Phasen ----------
drop policy if exists phasen_lesen on phasen;
create policy phasen_lesen on phasen
  for select using (
    exists (
      select 1 from events e
       where e.id = phasen.event_id
         and (e.status in ('veroeffentlicht', 'abgesagt') or ist_mitarbeiter('team'))
    )
  );

drop policy if exists phasen_pflegen on phasen;
create policy phasen_pflegen on phasen
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

-- ---------- Kunden ----------
drop policy if exists kunden_lesen on kunden;
create policy kunden_lesen on kunden
  for select using (user_id = auth.uid() or ist_mitarbeiter('team'));

drop policy if exists kunden_aendern on kunden;
create policy kunden_aendern on kunden
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists kunden_pflegen on kunden;
create policy kunden_pflegen on kunden
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

-- ---------- Bestellungen ----------
drop policy if exists bestellungen_lesen on bestellungen;
create policy bestellungen_lesen on bestellungen
  for select using (ist_eigener_kunde(kunde_id) or ist_mitarbeiter('team'));

drop policy if exists bestellungen_pflegen on bestellungen;
create policy bestellungen_pflegen on bestellungen
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

drop policy if exists positionen_lesen on bestellpositionen;
create policy positionen_lesen on bestellpositionen
  for select using (
    exists (
      select 1 from bestellungen b
       where b.id = bestellpositionen.bestellung_id
         and (ist_eigener_kunde(b.kunde_id) or ist_mitarbeiter('team'))
    )
  );

-- ---------- Tickets ----------
-- Am Einlass darf auch die Person mit der Rolle "einlass" lesen —
-- sonst kann der Scanner nichts anzeigen.
drop policy if exists tickets_lesen on tickets;
create policy tickets_lesen on tickets
  for select using (
    ist_mitarbeiter('einlass')
    or exists (
      select 1 from bestellungen b
       where b.id = tickets.bestellung_id
         and ist_eigener_kunde(b.kunde_id)
    )
  );

drop policy if exists tickets_pflegen on tickets;
create policy tickets_pflegen on tickets
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

-- ---------- VIP-Anfragen ----------
-- Jeder darf eine Anfrage stellen, auch ohne Konto. Lesen darf sie nur
-- das Team: eine Anfrage enthaelt Telefonnummer und Anlass.
drop policy if exists vip_anlegen on vip_anfragen;
create policy vip_anlegen on vip_anfragen for insert with check (true);

drop policy if exists vip_lesen on vip_anfragen;
create policy vip_lesen on vip_anfragen
  for select using (ist_mitarbeiter('team'));

drop policy if exists vip_pflegen on vip_anfragen;
create policy vip_pflegen on vip_anfragen
  for all using (ist_mitarbeiter('team')) with check (ist_mitarbeiter('team'));

-- ---------- Newsletter ----------
drop policy if exists newsletter_eintragen on newsletter;
create policy newsletter_eintragen on newsletter for insert with check (true);

drop policy if exists newsletter_lesen on newsletter;
create policy newsletter_lesen on newsletter
  for select using (ist_mitarbeiter('team'));

drop policy if exists newsletter_pflegen on newsletter;
create policy newsletter_pflegen on newsletter
  for all using (ist_mitarbeiter('admin')) with check (ist_mitarbeiter('admin'));

commit;

-- ---------- Selbstpruefung ----------
do $$
declare
  ohne text;
begin
  select string_agg(c.relname, ', ')
    into ohne
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in ('mitarbeiter','orte','events','phasen','kunden',
                       'bestellungen','bestellpositionen','tickets',
                       'vip_anfragen','newsletter')
     and not c.relrowsecurity;

  if ohne is not null then
    raise exception 'Ohne Zugriffsschutz: %', ohne;
  end if;
end $$;
