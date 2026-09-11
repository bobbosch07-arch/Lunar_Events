import type { Phase, Veranstaltung } from "./typen";
import { BEISPIEL_EVENTS, beispielPhasen } from "./beispieldaten";

/**
 * Eine Stelle, an der Events herkommen. Solange keine Supabase-Zugangsdaten
 * gesetzt sind, liefert sie die Beispielwelt — die Oberflaeche merkt davon
 * nichts. Beim Umstieg wird nur der Rumpf dieser Funktionen ersetzt.
 */

export function datenbankVerbunden(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function holeKommendeEvents(): Promise<Veranstaltung[]> {
  const jetzt = Date.now();
  return BEISPIEL_EVENTS.filter(
    (e) => e.status === "veroeffentlicht" && new Date(e.beginn).getTime() > jetzt,
  ).sort((a, b) => a.beginn.localeCompare(b.beginn));
}

export async function holeFeaturedEvents(): Promise<Veranstaltung[]> {
  const alle = await holeKommendeEvents();
  const markiert = alle.filter((e) => e.featured);
  // Ohne ausdrueckliche Auswahl zeigen wir die naechsten — nie eine leere
  // Flaeche, wo der Blick als erstes hinfaellt.
  return markiert.length > 0 ? markiert.slice(0, 3) : alle.slice(0, 3);
}

export async function holeEvent(slug: string): Promise<Veranstaltung | null> {
  return BEISPIEL_EVENTS.find((e) => e.slug === slug) ?? null;
}

export async function holePhasen(eventId: string): Promise<Phase[]> {
  return beispielPhasen(eventId).sort((a, b) => a.position - b.position);
}

export async function holeEventSlugs(): Promise<string[]> {
  return BEISPIEL_EVENTS.filter((e) => e.status === "veroeffentlicht").map(
    (e) => e.slug,
  );
}
