-- ============================================================
-- Lunar Events — Personal liest keine fremden Tickets mehr
--
-- Gefunden am 18.09.2026: `tickets_lesen` (0003) ließ alle mit Stufe
-- `einlass` (admin, kasse, einlass, bar) sämtliche Tickets samt Codes
-- lesen, `garderobe_marken_lesen` (0027) alle mit Stufe `garderobe`
-- sämtliche Garderobenmarken. Ein Code ist das Ticket: Wer ihn kennt, kommt
-- rein oder holt eine fremde Jacke ab. Eine Aushilfe an der Bar braucht
-- beides nicht.
--
-- Der einzige Personal-Weg, der `tickets` direkt las, war der Abgleich des
-- Scanners für den Betrieb ohne Netz. Er bekommt eine eigene Funktion, die
-- nur Prüfsummen herausgibt. Alles andere (Entwerten, Kasse, Garderobe,
-- Gästeliste) lief schon über Funktionen mit eigener Rollenprüfung.
--
-- Direkt lesen dürfen danach nur noch Admins und der Kunde selbst.
-- ============================================================

begin;

-- ---------- Tickets ----------
drop policy if exists tickets_lesen on tickets;
create policy tickets_lesen on tickets
  for select using (
    ist_mitarbeiter('team')
    or exists (
      select 1 from bestellungen b
       where b.id = tickets.bestellung_id
         and ist_eigener_kunde(b.kunde_id)
    )
  );

-- ---------- Garderobenmarken ----------
drop policy if exists garderobe_marken_lesen on garderobe_marken;
create policy garderobe_marken_lesen on garderobe_marken
  for select using (
    ist_mitarbeiter('team')
    or exists (
      select 1 from bestellungen b
       where b.id = garderobe_marken.bestellung_id
         and ist_eigener_kunde(b.kunde_id)
    )
  );

-- ---------- Prüfsummen für den Scanner ----------
-- Muss dasselbe liefern wie `pruefsumme()` im Scanner
-- (src/components/EinlassScanner.tsx): SHA-256 über den getrimmten Code in
-- Großbuchstaben, hexadezimal, die ersten 16 Zeichen. Die Selbstprüfung
-- unten hält einen bekannten Wert fest.
create or replace function einlass_pruefsumme(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select substr(encode(sha256(convert_to(upper(trim(p_code)), 'UTF8')), 'hex'), 1, 16);
$$;

-- Ohne Einlass-Recht kommt eine leere Liste zurück, wie vorher über die
-- Zugriffsregel.
create or replace function einlass_pruefsummen(p_event_id uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select einlass_pruefsumme(t.code)
    from tickets t
   where ist_mitarbeiter('einlass')
     and t.event_id = p_event_id
     and t.status = 'gueltig';
$$;

revoke all on function einlass_pruefsummen(uuid) from public, anon;
grant execute on function einlass_pruefsummen(uuid) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
declare
  v_regel text;
begin
  select qual into v_regel from pg_policies
   where tablename = 'tickets' and policyname = 'tickets_lesen';
  if v_regel is null or v_regel like '%einlass%' then
    raise exception 'tickets_lesen ist noch offen fürs Personal: %', v_regel;
  end if;

  select qual into v_regel from pg_policies
   where tablename = 'garderobe_marken' and policyname = 'garderobe_marken_lesen';
  if v_regel is null or v_regel like '%''garderobe''%' then
    raise exception 'garderobe_marken_lesen ist noch offen fürs Personal: %', v_regel;
  end if;

  -- sha256("ABC"), wie es auch der Browser rechnet
  if einlass_pruefsumme('  abc ') <> 'b5d4045c3f466fa9' then
    raise exception 'einlass_pruefsumme rechnet anders als der Scanner: %',
      einlass_pruefsumme('  abc ');
  end if;

  if has_function_privilege('anon', 'einlass_pruefsummen(uuid)', 'execute') then
    raise exception 'einlass_pruefsummen ist für anon aufrufbar';
  end if;
end $$;
