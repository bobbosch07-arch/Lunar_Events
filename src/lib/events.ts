import type { Phase, Veranstaltung } from "./typen";
import { BEISPIEL_EVENTS, beispielPhasen } from "./beispieldaten";
import { datenbankVerbunden, serverClient } from "./supabase/server";
import { phasenFolge, phasenZustaende } from "./typen";

/**
 * Eine Stelle, an der Events herkommen.
 *
 * In der Entwicklung springt die Beispielwelt ein, solange keine Datenbank
 * erreichbar ist. **In Produktion nie** — siehe `ersatzErlaubt()` weiter
 * unten. Eine *leere* Datenbank ist ohnehin immer eine echte Antwort:
 * dann bleibt die Liste leer, statt etwas vorzugaukeln, das niemand
 * verkaufen kann.
 */

const AUSWAHL = `
  id, slug, titel, untertitel, teaser, beschreibung, kategorie, status,
  beginn, einlass, ende, bild_pfad, bild_alt, bild_fokus, mindestalter,
  dresscode, veranstalter, abendkasse, abendkasse_hinweis, featured,
  fastlane_aktiv, fastlane_preis_cent, fastlane_kontingent, fastlane_verkauft,
  fastlane_beschreibung, presale_ab, verkauf_ab,
  garderobe_aktiv, garderobe_preis_cent, garderobe_kontingent, garderobe_verkauft,
  streichpreis_cent,
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
    abendkasse: (z.abendkasse as boolean) ?? false,
  };
}

/**
 * Was die Öffentlichkeit sieht. Abendkassen-Phasen (0025) gehören der Tür:
 * Sie haben eigene Preise und ein eigenes Kontingent und würden online nur
 * verwirren — kaufbar sind sie dort ohnehin nicht (reserviere prüft es).
 */
function nurOnline(phasen: Phase[]): Phase[] {
  return phasen.filter((p) => !p.abendkasse);
}

/** Fast Lane nur anbieten, wenn eingeschaltet und nicht vergriffen. */
function fastlaneAus(z: Zeile): Veranstaltung["fastlane"] {
  if (!z.fastlane_aktiv) return null;
  const kontingent = (z.fastlane_kontingent as number | null) ?? null;
  const rest = kontingent === null ? null : kontingent - ((z.fastlane_verkauft as number) ?? 0);
  if (rest !== null && rest <= 0) return null;
  return {
    preis_cent: (z.fastlane_preis_cent as number) ?? 0,
    rest,
    beschreibung: (z.fastlane_beschreibung as string | null) ?? null,
  };
}

/** Garderobe nur anbieten, wenn eingeschaltet und nicht voll (0027). */
function garderobeAus(z: Zeile): Veranstaltung["garderobe"] {
  if (!z.garderobe_aktiv) return null;
  const kontingent = (z.garderobe_kontingent as number | null) ?? null;
  const rest = kontingent === null ? null : kontingent - ((z.garderobe_verkauft as number) ?? 0);
  if (rest !== null && rest <= 0) return null;
  return { preis_cent: (z.garderobe_preis_cent as number) ?? 0, rest };
}

/**
 * Streichpreis (0030): Gibt es eine aktive Abendkassen-Phase, ist deren Preis
 * die Wahrheit — sonst das Feld am Event.
 */
function streichpreisAus(z: Zeile, allePhasen: Phase[]): number | null {
  const tuer = allePhasen
    .filter((p) => p.abendkasse && p.aktiv && p.art === "standard")
    .sort(phasenFolge)[0];
  if (tuer) return tuer.preis_cent + tuer.gebuehr_cent;
  return (z.streichpreis_cent as number | null) ?? null;
}

function baueEvent(z: Zeile): Veranstaltung {
  const allePhasen = ((z.phasen as Zeile[]) ?? []).map(bauePhase);
  const phasen = nurOnline(allePhasen);
  const zustaende = phasenZustaende(phasen);
  const kaufbar = phasen.filter((p) => zustaende.get(p.id)?.art === "kaufbar");

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
    fastlane: fastlaneAus(z),
    garderobe: garderobeAus(z),
    streichpreis_cent: streichpreisAus(z, allePhasen),
    presale_ab: (z.presale_ab as string | null) ?? null,
    verkauf_ab: (z.verkauf_ab as string | null) ?? null,
  };
}

/**
 * Im Betrieb gibt es keine Beispieldaten.
 *
 * Ein stiller Rückfall hat die öffentliche Seite schon einmal erfundene
 * Events anbieten lassen, weil in der Hosting-Umgebung die Zugangsdaten
 * fehlten — niemandem fiel es auf, die Seite sah ja gut aus. Wer in
 * Produktion keine Datenbank hat, zeigt lieber nichts.
 */
function ersatzErlaubt(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function ausDatenbank<T>(
  was: string,
  abfrage: () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>,
  ersatz: () => T,
  leer: () => T,
  abbilden: (zeilen: Zeile[]) => T,
): Promise<T> {
  if (!datenbankVerbunden()) {
    if (ersatzErlaubt()) return ersatz();
    console.error(
      `[events] ${was}: keine Supabase-Zugangsdaten gesetzt. ` +
        `NEXT_PUBLIC_SUPABASE_URL und den oeffentlichen Schluessel eintragen ` +
        `(PUBLISHABLE_KEY oder ANON_KEY) und neu ausliefern — ` +
        `NEXT_PUBLIC_-Werte werden beim Bauen eingesetzt. Stand: /api/status`,
    );
    return leer();
  }

  const { data, error } = await abfrage();

  if (tabelleFehlt(error)) {
    console.error(
      `[events] ${was}: Tabellen fehlen. ` +
        `Migrationen aus supabase/migrations/ einspielen.`,
    );
    return ersatzErlaubt() ? ersatz() : leer();
  }
  if (error) {
    console.error(`[events] ${was} fehlgeschlagen:`, error.message);
    return ersatzErlaubt() ? ersatz() : leer();
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
    () => [],
    (zeilen) => zeilen.map(baueEvent),
  );
}

/**
 * Events für Einlass und Abendkasse: die kommenden **und** die, die gerade
 * laufen. Eine Nacht, die um 23 Uhr begonnen hat, läuft um zwei noch — und
 * genau dann wird gescannt und kassiert. `holeKommendeEvents()` taugt dafür
 * nicht: Sie lässt ein Event fallen, sobald es begonnen hat, und hat den
 * Scanner damit zur Hauptzeit leer gemacht.
 */
export async function holeEventsFuerDenAbend(): Promise<Veranstaltung[]> {
  // Wer um 23 Uhr beginnt, ist bis in den Morgen in Betrieb.
  const seit = new Date(Date.now() - 18 * 3_600_000).toISOString();

  return ausDatenbank(
    "holeEventsFuerDenAbend",
    async () => {
      const db = await serverClient();
      return db
        .from("events")
        .select(AUSWAHL)
        .eq("status", "veroeffentlicht")
        .gt("beginn", seit)
        .order("beginn", { ascending: true });
    },
    () => BEISPIEL_EVENTS.filter((e) => e.status === "veroeffentlicht" && e.beginn > seit),
    () => [],
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
    () => null,
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
    () => [],
    (zeilen) => nurOnline(zeilen.map(bauePhase)),
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
    () => [],
    (zeilen) => zeilen.map((z) => z.slug as string),
  );
}
