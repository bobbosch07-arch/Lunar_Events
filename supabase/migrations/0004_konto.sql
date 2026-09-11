-- ============================================================
-- Lunar Events — Konto und Gastkäufe zusammenführen
--
-- Der Normalfall bei Ticketing: Jemand kauft als Gast, bekommt seine
-- Tickets, und meldet sich erst Wochen später an. Ohne Verknüpfung wäre
-- sein Konto dann leer, obwohl die Tickets existieren.
--
-- Die E-Mail-Adresse ist der Schlüssel: Wer sich mit derselben Adresse
-- anmeldet, an die die Tickets gingen, bekommt sie zu sehen. Supabase
-- bestätigt die Adresse beim Anmeldelink, sie ist also nachgewiesen.
-- ============================================================

begin;

create or replace function verknuepfe_kunde_mit_konto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Vorhandenen Kunden übernehmen …
  update kunden
     set user_id = new.id
   where email = new.email
     and user_id is null;

  -- … oder einen anlegen, falls es noch keinen gibt.
  if not found then
    insert into kunden (email, user_id)
         values (new.email, new.id)
    on conflict (email) do update
       set user_id = coalesce(kunden.user_id, excluded.user_id);
  end if;

  return new;
end;
$$;

drop trigger if exists kunde_verknuepfen on auth.users;
create trigger kunde_verknuepfen
  after insert on auth.users
  for each row execute function verknuepfe_kunde_mit_konto();

-- Bestehende Konten nachziehen, falls schon welche existieren.
update kunden k
   set user_id = u.id
  from auth.users u
 where k.email = u.email
   and k.user_id is null;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'kunde_verknuepfen'
       and tgrelid = 'auth.users'::regclass
  ) then
    raise exception 'Trigger kunde_verknuepfen fehlt';
  end if;
end $$;
