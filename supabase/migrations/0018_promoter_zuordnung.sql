-- ============================================================
-- Lunar Events — Promoter: Zuordnung und Statistik
--
-- Zwei Funktionen, damit die Regeln an einer Stelle stehen und sich ohne
-- Browser prüfen lassen (scripts/promoter-testen.mjs).
-- ============================================================

begin;

-- ---------- Bestellung einem Promoter zuordnen ----------
-- Aufgerufen vom Server direkt nach reserviere().
--
-- Vorrang hat der Code: Wer den Code eines Promoters eintippt, hat ihn von
-- dieser Person — auch wenn er über den Link eines anderen kam. Ohne Code
-- zählt das Kürzel aus dem Link. Pausierte Promoter zählen nicht.
-- Eine schon gesetzte Zuordnung wird nie überschrieben.
create or replace function ordne_promoter_zu(p_bestellung_id uuid, p_kuerzel text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select coalesce(
           (select r.promoter_id
              from bestellungen b
              join rabattcodes r on r.id = b.rabattcode_id
              join promoter p on p.id = r.promoter_id and p.aktiv
             where b.id = p_bestellung_id),
           (select p.id
              from promoter p
             where p.kuerzel = lower(trim(coalesce(p_kuerzel, '')))
               and p.aktiv)
         )
    into v_id;

  if v_id is null then
    return null;
  end if;

  update bestellungen
     set promoter_id = v_id
   where id = p_bestellung_id
     and promoter_id is null;

  return (select promoter_id from bestellungen where id = p_bestellung_id);
end;
$$;

-- ---------- Statistik hinter dem geheimen Link ----------
-- Gibt null zurück, wenn der Token nicht passt. Enthält nur, was der
-- Promoter sehen soll: je Event Klicks und verkaufte Tickets, dazu seine
-- gültigen Codes und die kommenden Events für seine Links. Kein Umsatz,
-- keine Namen.
create or replace function promoter_statistik(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_p promoter%rowtype;
begin
  -- Kurze Rateversuche beschäftigen die Tabelle gar nicht erst.
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into v_p from promoter where token = p_token;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'name', v_p.name,
    'kuerzel', v_p.kuerzel,
    'aktiv', v_p.aktiv,
    'events', coalesce((
      select jsonb_agg(to_jsonb(z) order by z.beginn desc)
        from (
          select e.id,
                 e.titel,
                 e.slug,
                 e.beginn,
                 (e.status = 'veroeffentlicht' and e.beginn > now()) as kommend,
                 (select count(*)
                    from ereignisse x
                   where x.promoter_id = v_p.id
                     and x.event_id = e.id
                     and x.art = 'event_gesehen')::int as klicks,
                 (select coalesce(sum(bp.menge), 0)
                    from bestellungen b
                    join bestellpositionen bp on bp.bestellung_id = b.id
                   where b.promoter_id = v_p.id
                     and b.event_id = e.id
                     and b.status = 'bezahlt')::int as tickets
            from events e
           where (e.status = 'veroeffentlicht' and e.beginn > now())
              or exists (select 1 from bestellungen b
                          where b.promoter_id = v_p.id and b.event_id = e.id
                            and b.status = 'bezahlt')
              or exists (select 1 from ereignisse x
                          where x.promoter_id = v_p.id and x.event_id = e.id)
        ) z
    ), '[]'::jsonb),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', r.code, 'art', r.art, 'wert', r.wert, 'event_id', r.event_id)
             order by r.code)
        from rabattcodes r
       where r.promoter_id = v_p.id
         and r.aktiv
         and (r.gueltig_ab is null or r.gueltig_ab <= now())
         and (r.gueltig_bis is null or r.gueltig_bis > now())
         and (r.max_tickets is null or r.eingeloest < r.max_tickets)
    ), '[]'::jsonb)
  );
end;
$$;

-- Beide nur für den Server. Die Statistik öffentlich aufrufbar zu machen,
-- hieße Tokens über die Schnittstelle durchprobieren zu lassen.
revoke execute on function ordne_promoter_zu(uuid, text) from public, anon, authenticated;
grant execute on function ordne_promoter_zu(uuid, text) to service_role;
revoke execute on function promoter_statistik(text) from public, anon, authenticated;
grant execute on function promoter_statistik(text) to service_role;

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if has_function_privilege('anon', 'public.promoter_statistik(text)', 'execute')
     or has_function_privilege('authenticated', 'public.promoter_statistik(text)', 'execute') then
    raise exception 'promoter_statistik ist öffentlich aufrufbar';
  end if;
  if has_function_privilege('anon', 'public.ordne_promoter_zu(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.ordne_promoter_zu(uuid, text)', 'execute') then
    raise exception 'ordne_promoter_zu ist öffentlich aufrufbar';
  end if;
  if not has_function_privilege('service_role', 'public.promoter_statistik(text)', 'execute')
     or not has_function_privilege('service_role', 'public.ordne_promoter_zu(uuid, text)', 'execute') then
    raise exception 'Server kann die Promoter-Funktionen nicht aufrufen';
  end if;
  if promoter_statistik('zu-kurz') is not null
     or promoter_statistik(repeat('x', 64)) is not null then
    raise exception 'promoter_statistik antwortet auf einen falschen Token';
  end if;
end $$;
