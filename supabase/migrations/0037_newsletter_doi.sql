-- ============================================================
-- Lunar Events — Newsletter mit Double-Opt-in (C7)
--
-- Die Tabelle trug schon `bestaetigt` und `token`, verschickt wurde aber nie
-- eine Bestätigung — jede eingetragene Adresse galt sofort als Interessent.
-- Für einen Newsletter braucht es den nachweisbaren Klick: Erst wer den Link
-- in der Mail bestätigt, steht drauf. Dazu der Zeitpunkt (Nachweis) und ein
-- Abmeldeweg.
-- ============================================================

begin;

alter table newsletter
  add column if not exists bestaetigt_am timestamptz,
  add column if not exists abgemeldet_am timestamptz;

-- Bestätigt eine Eintragung über den Token aus der Mail.
create or replace function bestaetige_newsletter(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext;
begin
  if p_token is null or length(p_token) < 16 then
    return false;
  end if;
  update newsletter
     set bestaetigt     = true,
         bestaetigt_am  = coalesce(bestaetigt_am, now()),
         abgemeldet_am  = null
   where token = p_token
   returning email into v_email;
  return v_email is not null;
end;
$$;

-- Meldet über den Token wieder ab.
create or replace function melde_newsletter_ab(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email citext;
begin
  if p_token is null or length(p_token) < 16 then
    return false;
  end if;
  update newsletter
     set bestaetigt    = false,
         abgemeldet_am = coalesce(abgemeldet_am, now())
   where token = p_token
   returning email into v_email;
  return v_email is not null;
end;
$$;

revoke execute on function bestaetige_newsletter(text) from public, anon, authenticated;
revoke execute on function melde_newsletter_ab(text) from public, anon, authenticated;
grant execute on function bestaetige_newsletter(text) to service_role;
grant execute on function melde_newsletter_ab(text) to service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_token text;
  v_bestaetigt boolean;
begin
  insert into newsletter (email) values ('selbsttest-0037-' || gen_random_uuid() || '@example.invalid')
    returning token into v_token;

  if bestaetige_newsletter('zu-kurz') then raise exception 'Kurzer Token bestätigt'; end if;
  if not bestaetige_newsletter(v_token) then raise exception 'Bestätigung greift nicht'; end if;
  select bestaetigt into v_bestaetigt from newsletter where token = v_token;
  if not v_bestaetigt then raise exception 'bestaetigt nicht gesetzt'; end if;

  if not melde_newsletter_ab(v_token) then raise exception 'Abmelden greift nicht'; end if;
  select bestaetigt into v_bestaetigt from newsletter where token = v_token;
  if v_bestaetigt then raise exception 'Nach Abmelden noch bestätigt'; end if;

  delete from newsletter where token = v_token;

  if has_function_privilege('anon', 'bestaetige_newsletter(text)', 'execute') then
    raise exception 'anon darf bestaetige_newsletter';
  end if;
end $$;
