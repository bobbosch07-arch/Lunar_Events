-- ============================================================
-- Lunar Events — Phasenzähler abgleichen (13.10.2026)
--
-- `phasen.verkauft` ist ein Zähler: reserviere() zählt hoch, der Aufräumlauf
-- gibt verfallene Reservierungen zurück. Nicht zurück gibt er, wenn eine
-- bezahlte Bestellung erstattet und ihr Ticket storniert wird, oder wenn
-- jemand eine Bestellung von Hand löscht. Dann steht der Zähler höher, als
-- es Tickets gibt: Bei THE OPENING stand Early Bird auf 29, bezahlt waren 28
-- (vermutlich der erstattete Live-Testkauf vom 19.09., dessen Bestellung
-- später gelöscht wurde).
--
-- Soll je Phase: Tickets in offenen Bestellungen (Reservierung, Überweisung)
-- plus gültige oder eingelöste Tickets bezahlter Bestellungen. Stornierte
-- Tickets zählen nicht: Ihr Platz ist wieder verkäuflich.
-- ============================================================

begin;

-- Soll und Ist je Phase, für die Warnung in der Übersicht.
create or replace function phasen_zaehlerstand(p_event_id uuid)
returns table (phase_id uuid, ist int, soll int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ist_mitarbeiter('team') then
    raise exception 'NUR_TEAM';
  end if;
  return query
    select p.id,
           p.verkauft,
           (coalesce((select sum(bp.menge)
                        from bestellpositionen bp
                        join bestellungen b on b.id = bp.bestellung_id
                       where bp.phase_id = p.id and b.status = 'offen'), 0)
            + coalesce((select count(*)
                          from tickets t
                          join bestellungen b on b.id = t.bestellung_id
                         where t.phase_id = p.id and b.status = 'bezahlt'
                           and t.status <> 'storniert'), 0))::int
      from phasen p
     where p.event_id = p_event_id;
end;
$$;

-- Setzt den Zähler jeder Phase des Events auf das Soll. Nur Admins, unter
-- Sperre aller Phasen des Events. Liegt das Soll über dem Kontingent (der
-- Zähler war zu niedrig und es ist überbucht), wird nichts geändert: Das
-- muss ein Mensch ansehen.
create or replace function phasen_abgleichen(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zeile record;
  v_geaendert jsonb := '[]'::jsonb;
begin
  if not ist_mitarbeiter('admin') then
    raise exception 'NUR_ADMIN';
  end if;
  perform 1 from phasen where event_id = p_event_id order by id for update;

  for v_zeile in
    select z.phase_id, z.ist, z.soll, p.name, p.kontingent
      from phasen_zaehlerstand(p_event_id) z
      join phasen p on p.id = z.phase_id
     where z.ist <> z.soll
  loop
    if v_zeile.kontingent is not null and v_zeile.soll > v_zeile.kontingent then
      raise exception 'UEBERBUCHT:%:%:%', v_zeile.name, v_zeile.soll, v_zeile.kontingent;
    end if;
    update phasen set verkauft = v_zeile.soll where id = v_zeile.phase_id;
    v_geaendert := v_geaendert || jsonb_build_object(
      'phase', v_zeile.name, 'vorher', v_zeile.ist, 'nachher', v_zeile.soll);
  end loop;

  return jsonb_build_object('event_id', p_event_id, 'geaendert', v_geaendert);
end;
$$;

revoke execute on function phasen_zaehlerstand(uuid) from public, anon;
revoke execute on function phasen_abgleichen(uuid) from public, anon;
grant execute on function phasen_zaehlerstand(uuid) to authenticated, service_role;
grant execute on function phasen_abgleichen(uuid) to authenticated, service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if has_function_privilege('anon', 'public.phasen_abgleichen(uuid)', 'execute') then
    raise exception 'phasen_abgleichen ist für anon aufrufbar';
  end if;
  begin
    perform phasen_abgleichen(gen_random_uuid());
    raise exception 'phasen_abgleichen ohne Admin durchgelassen';
  exception when raise_exception then
    if sqlerrm <> 'NUR_ADMIN' then raise; end if;
  end;
end $$;
