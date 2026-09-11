import type { Phase, Veranstaltung } from "./typen";
import { BEISPIEL_EVENTS, beispielPhasen } from "./beispieldaten";
import { datenbankVerbunden, serverClient } from "./supabase/server";
import { phasenZustand } from "./typen";

/**
 * Eine Stelle, an der Events herkommen.
 *
 * Steht die Datenbank noch nicht (Tabellen fehlen), liefert sie die
 * Beispielwelt und sagt es im Log deutlich. Eine *leere* Datenbank ist
 * dagegen eine echte Antwort — dann bleibt die Liste leer, statt
 * Beispieldaten vorzugaukeln, die niemand verkaufen kann.
 */

const AUSWAHL = `
  id, slug, titel, untertitel, teaser, beschreibung, kategorie, status,
  beginn, einlass, ende, bild_pfad, bild_alt, bild_fokus, mindestalter,
  dresscode, veranstalter, abendkasse, abendkasse_hinweis, featured,
  ort:orte(*),
  phasen(*)
`;

/** Fehlt die Tabelle, ist die Migration noch nicht eingespielt. */
function tabelleFehlt(fehler: { code?: string; message?: string } | null) {
  if (!fehler) return false;
  return (
    fehler.code === "42P01" ||
    fehler.code === "PGRST205" ||
    (fehler.message ?? "").includes("does not exist")
  );
}

type Zeile = Record<string, unknown>;

function bauePhase(z: Zeile): Phase {
  return {
    id: z.id as string,
    event_id: z.event_id as string,
    name: z.name as string,
    art: z.art as Phase["art"],
    preis_cent: z.preis_cent as number,
    gebuehr_cent: (z.gebuehr_cent as number) ?? 0,
    kontingent: (z.kontingent as number | null) ?? null,
    verkauft: (z.verkauft as number) ?? 0,
    ab: (z.ab as string | null) ?? null,
    bis: (z.bis as string | null) ?? null,
    leistungen: (z.leistungen as string[]) ?? [],
    beschreibung: (z.beschreibung as string | null) ?? null,
    position: (z.position as number) ?? 0,
    aktiv: (z.aktiv as boolean) ?? true,
  };
}

function baueEvent(z: Zeile): Veranstaltung {
  const phasen = ((z.phasen as Zeile[]) ?? []).map(bauePhase);
  const kaufbar = phasen.filter((p) => phasenZustand(p).art === "kaufbar");

  const abPreis =
    kaufbar.length > 0
      ? Math.min(...kaufbar.map((p) => p.preis_cent + p.gebuehr_cent))
      : null;

  const standard = phasen.filter((p) => p.art === "standard");

  return {
    id: z.id as string,
    slug: z.slug as string,
    titel: z.titel as string,
    untertitel: (z.untertitel as string | null) ?? null,
    teaser: (z.teaser as string | null) ?? null,
    beschreibung: (z.beschreibung as string | null) ?? null,
    kategorie: z.kategorie as Veranstaltung["kategorie"],
    status: z.status as Veranstaltung["status"],
    beginn: z.beginn as string,
    einlass: (z.einlass as string | null) ?? null,
    ende: (z.ende as string | null) ?? null,
    ort: z.ort as Veranstaltung["ort"],
    bild: z.bild_pfad
      ? {
          pfad: z.bild_pfad as string,
          alt: (z.bild_alt as string | null) ?? null,
          fokus: (z.bild_fokus as string | null) ?? null,
        }
      : null,
    mindestalter: (z.mindestalter as number | null) ?? null,
    dresscode: (z.dresscode as string | null) ?? null,
    veranstalter: (z.veranstalter as string) ?? "Lunar Events",
    abendkasse: (z.abendkasse as boolean) ?? false,
    abendkasse_hinweis: (z.abendkasse_hinweis as string | null) ?? null,
    featured: (z.featured as boolean) ?? false,
    ab_preis_cent: abPreis,
    vip_verfuegbar: phasen.some(
      (p) => p.art === "vip" && p.aktiv && (p.kontingent === null || p.verkauft < p.kontingent),
    ),
    // Ausverkauft heisst: es gibt Standardphasen, aber keine davon ist
    // noch kaufbar. Ein Event ganz ohne Phasen ist nicht ausverkauft,
    // sondern noch nicht bepreist.
    ausverkauft: standard.length > 0 && kaufbar.length === 0,
  };
}

async function ausDatenbank<T>(
  was: string,
  abfrage: () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  ersatz: () => T,
  abbilden: (zeilen: Zeile[]) => T,
): Promise<T> {
  if (!datenbankVerbunden()) return ersatz();

  const { data, error } = await abfrage();

  if (tabelleFehlt(error)) {
    console.warn(
      `[events] ${was}: Tabellen fehlen — es laufen Beispieldaten. ` +
        `Migrationen aus supabase/migrations/ einspielen.`,
    );
    return ersatz();
  }
  if (error) {
    console.error(`[events] ${was} fehlgeschlagen:`, error.message);
    return ersatz();
  }

  return abbilden((data as Zeile[]) ?? []);
}

export async function holeKommendeEvents(): Promise<Veranstaltung[]> {
  const jetzt = new Date().toISOString();

  return ausDatenbank(
    "holeKommendeEvents",
    async () => {
      const db = await serverClient();
      return db
        .from("events")
        .select(AUSWAHL)
        .eq("status", "veroeffentlicht")
        .gt("beginn", jetzt)
        .order("beginn", { ascending: true });
    },
    () =>
      BEISPIEL_EVENTS.filter(
        (e) => e.status === "veroeffentlicht" && e.beginn > jetzt,
      ).sort((a, b) => a.beginn.localeCompare(b.beginn)),
    (zeilen) => zeilen.map(baueEvent),
  );
}

export async function holeFeaturedEvents(): Promise<Veranstaltung[]> {
  const alle = await holeKommendeEvents();
  const markiert = alle.filter((e) => e.featured);
  // Ohne ausdrueckliche Auswahl zeigen wir die naechsten — nie eine leere
  // Flaeche, wo der Blick als erstes hinfaellt.
  return markiert.length > 0 ? markiert.slice(0, 3) : alle.slice(0, 3);
}

export async function holeEvent(slug: string): Promise<Veranstaltung | null> {
  return ausDatenbank(
    "holeEvent",
    async () => {
      const db = await serverClient();
      return db.from("events").select(AUSWAHL).eq("slug", slug).limit(1);
    },
    () => BEISPIEL_EVENTS.find((e) => e.slug === slug) ?? null,
    (zeilen) => (zeilen.length > 0 ? baueEvent(zeilen[0]) : null),
  );
}

export async function holePhasen(eventId: string): Promise<Phase[]> {
  return ausDatenbank(
    "holePhasen",
    async () => {
      const db = await serverClient();
      return db
        .from("phasen")
        .select("*")
        .eq("event_id", eventId)
        .order("position", { ascending: true });
    },
    () => beispielPhasen(eventId).sort((a, b) => a.position - b.position),
    (zeilen) => zeilen.map(bauePhase),
  );
}

export async function holeEventSlugs(): Promise<string[]> {
  return ausDatenbank(
    "holeEventSlugs",
    async () => {
      const db = await serverClient();
      return db.from("events").select("slug").eq("status", "veroeffentlicht");
    },
    () =>
      BEISPIEL_EVENTS.filter((e) => e.status === "veroeffentlicht").map(
        (e) => e.slug,
      ),
    (zeilen) => zeilen.map((z) => z.slug as string),
  );
}
