-- ============================================================
-- Lunar Events — Eventbilder
--
-- Die Fotografie trägt laut Briefing die halbe Gestaltung. Bisher gab
-- es keinen Weg, ein Bild an ein Event zu hängen — das Feld bild_pfad
-- existierte, blieb aber immer leer.
--
-- Der Ablageort ist öffentlich lesbar: Eventbilder stehen ohnehin auf
-- einer öffentlichen Seite, und signierte Adressen würden nur das
-- Zwischenspeichern verhindern. Schreiben darf nur das Team.
-- ============================================================

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     values (
       'events',
       'events',
       true,
       10485760, -- 10 MB: mehr braucht ein Webbild nicht, auch kein gutes
       array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
     )
on conflict (id) do update
   set public = excluded.public,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "eventbilder oeffentlich lesbar" on storage.objects;
create policy "eventbilder oeffentlich lesbar"
  on storage.objects for select
  using (bucket_id = 'events');

drop policy if exists "eventbilder vom team schreibbar" on storage.objects;
create policy "eventbilder vom team schreibbar"
  on storage.objects for insert
  with check (bucket_id = 'events' and public.ist_mitarbeiter('team'));

drop policy if exists "eventbilder vom team aenderbar" on storage.objects;
create policy "eventbilder vom team aenderbar"
  on storage.objects for update
  using (bucket_id = 'events' and public.ist_mitarbeiter('team'));

drop policy if exists "eventbilder vom team loeschbar" on storage.objects;
create policy "eventbilder vom team loeschbar"
  on storage.objects for delete
  using (bucket_id = 'events' and public.ist_mitarbeiter('team'));

commit;

-- ---------- Selbstprüfung ----------
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'events') then
    raise exception 'Der Ablageort für Eventbilder fehlt';
  end if;
end $$;
