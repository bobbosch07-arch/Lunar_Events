"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { berlinNachUtc } from "@/lib/zeit";
import { bedieneWarteliste } from "@/lib/warteliste";
import type { EventAbschnitt } from "@/lib/event-stand";

export type PhasenEingabe = {
  id?: string;
  name: string;
  art: "standard" | "vip";
  preis_cent: number;
  gebuehr_cent: number;
  kontingent: number | null;
  leistungen: string[];
  beschreibung: string | null;
  position: number;
  aktiv: boolean;
  abendkasse: boolean;
};

export type EventEingabe = {
  id?: string;
  slug: string;
  titel: string;
  untertitel: string | null;
  teaser: string | null;
  beschreibung: string | null;
  kategorie: string;
  status: string;
  /** Ortszeit aus dem Formular, z. B. "2026-10-24T23:00". */
  beginn: string;
  einlass: string | null;
  ende: string | null;
  ort_id: string | null;
  neuer_ort: { name: string; stadt: string; strasse: string; plz: string } | null;
  bild_pfad: string | null;
  bild_alt: string | null;
  bild_fokus: string | null;
  poster_statt_bild: boolean;
  mindestalter: number | null;
  dresscode: string | null;
  lineup: string[];
  abendkasse: boolean;
  abendkasse_hinweis: string | null;
  /** Streichpreis (0030), null = keiner. */
  streichpreis_cent: number | null;
  featured: boolean;
  fastlane_aktiv: boolean;
  fastlane_preis_cent: number;
  fastlane_kontingent: number | null;
  fastlane_beschreibung: string | null;
  garderobe_aktiv: boolean;
  garderobe_preis_cent: number;
  garderobe_kontingent: number | null;
  /** Ortszeit aus dem Formular, "" oder null = nicht gesetzt */
  presale_ab: string | null;
  verkauf_ab: string | null;
  phasen: PhasenEingabe[];
};

export type SpeicherErgebnis =
  | { ok: true; slug: string }
  | { ok: false; fehler: string };

export async function speichereEvent(
  eingabe: EventEingabe,
): Promise<SpeicherErgebnis> {
  const db = await serverClient();

  const slug = eingabe.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) return { ok: false, fehler: "Die Adresse (Slug) fehlt." };
  if (!eingabe.titel.trim()) return { ok: false, fehler: "Der Titel fehlt." };
  if (!eingabe.beginn) return { ok: false, fehler: "Der Beginn fehlt." };

  // Presale braucht einen Zeitpunkt, an dem er endet — den öffentlichen
  // Verkaufsstart. Dieselbe Regel steht in der Tabelle (events_presale_gueltig).
  const presaleAb = eingabe.presale_ab ? berlinNachUtc(eingabe.presale_ab) : null;
  const verkaufAb = eingabe.verkauf_ab ? berlinNachUtc(eingabe.verkauf_ab) : null;
  if (presaleAb && !verkaufAb) {
    return { ok: false, fehler: "Für den Presale fehlt der öffentliche Verkaufsstart." };
  }
  if (presaleAb && verkaufAb && presaleAb >= verkaufAb) {
    return { ok: false, fehler: "Der Presale muss vor dem öffentlichen Verkauf beginnen." };
  }

  // --- Ort ---
  let ortId = eingabe.ort_id;
  if (!ortId && eingabe.neuer_ort) {
    const { name, stadt, strasse, plz } = eingabe.neuer_ort;
    if (!name.trim() || !stadt.trim()) {
      return { ok: false, fehler: "Für einen neuen Ort brauchen wir Name und Stadt." };
    }
    const { data, error } = await db
      .from("orte")
      .insert({
        name: name.trim(),
        stadt: stadt.trim(),
        strasse: strasse.trim() || null,
        plz: plz.trim() || null,
        land: "DE",
      })
      .select("id")
      .single();
    if (error) return { ok: false, fehler: `Ort anlegen: ${error.message}` };
    ortId = data.id;
  }
  if (!ortId) return { ok: false, fehler: "Es fehlt der Ort." };

  const zeile = eventZeile(eingabe, slug, ortId);

  const { data: event, error } = eingabe.id
    ? await db.from("events").update(zeile).eq("id", eingabe.id).select("id, slug").single()
    : await db.from("events").insert(zeile).select("id, slug").single();

  if (error) return { ok: false, fehler: deuteEventFehler(error, slug) };

  // --- Phasen ---
  // Nur beim Anlegen. Bei einem bestehenden Event schrieb dieses Formular
  // früher alle Phasen mit dem Stand beim Öffnen zurück; wer in der
  // Zwischenzeit verkauft oder Kontingente verschoben hatte, wurde still
  // überschrieben. Seit 13.10.2026 laufen Phasen bestehender Events über die
  // Übersicht (aktionen/kontingente.ts), jede Änderung für sich.
  if (!eingabe.id) {
    for (const phase of eingabe.phasen) {
      const { error: pf } = await db.from("phasen").insert({
        event_id: event.id,
        name: phase.name.trim(),
        art: phase.art,
        preis_cent: phase.art === "vip" ? 0 : Math.max(0, phase.preis_cent),
        gebuehr_cent: phase.art === "vip" ? 0 : Math.max(0, phase.gebuehr_cent),
        kontingent: phase.kontingent,
        leistungen: phase.leistungen.filter((l) => l.trim()),
        beschreibung: phase.beschreibung?.trim() || null,
        position: phase.position,
        aktiv: phase.aktiv,
        abendkasse: phase.abendkasse,
        verkauft: 0,
      });
      if (pf) return { ok: false, fehler: `Phase „${phase.name}": ${pf.message}` };
    }
  }

  // Mehr Kontingent heißt: Wer auf der Warteliste steht, ist zuerst dran —
  // jetzt gleich, nicht erst beim nächsten Takt. Sonst kaufte in den Minuten
  // dazwischen jemand, der nie gewartet hat.
  await bedieneWarteliste(event.id as string);

  revalidatePath("/backoffice/events");
  revalidatePath("/events");
  revalidatePath(`/events/${event.slug}`);
  revalidatePath("/");

  return { ok: true, slug: event.slug as string };
}

/** Die Datenbankzeile eines Events aus der Formulareingabe. */
function eventZeile(eingabe: EventEingabe, slug: string, ortId: string) {
  const presaleAb = eingabe.presale_ab ? berlinNachUtc(eingabe.presale_ab) : null;
  const verkaufAb = eingabe.verkauf_ab ? berlinNachUtc(eingabe.verkauf_ab) : null;
  return {
    slug,
    titel: eingabe.titel.trim(),
    untertitel: eingabe.untertitel?.trim() || null,
    teaser: eingabe.teaser?.trim() || null,
    beschreibung: eingabe.beschreibung?.trim() || null,
    kategorie: eingabe.kategorie,
    status: eingabe.status,
    beginn: berlinNachUtc(eingabe.beginn),
    einlass: eingabe.einlass ? berlinNachUtc(eingabe.einlass) : null,
    ende: eingabe.ende ? berlinNachUtc(eingabe.ende) : null,
    ort_id: ortId,
    bild_pfad: eingabe.bild_pfad || null,
    bild_alt: eingabe.bild_alt?.trim() || null,
    bild_fokus: eingabe.bild_fokus || null,
    poster_statt_bild: Boolean(eingabe.poster_statt_bild),
    mindestalter: eingabe.mindestalter,
    dresscode: eingabe.dresscode?.trim() || null,
    lineup: eingabe.lineup,
    abendkasse: eingabe.abendkasse,
    abendkasse_hinweis: eingabe.abendkasse_hinweis?.trim() || null,
    // 0 oder Unsinn heißt: kein Streichpreis (die Tabelle erlaubt nur > 0).
    streichpreis_cent:
      eingabe.streichpreis_cent && eingabe.streichpreis_cent > 0 ? eingabe.streichpreis_cent : null,
    featured: eingabe.featured,
    fastlane_aktiv: eingabe.fastlane_aktiv,
    fastlane_preis_cent: Math.max(0, eingabe.fastlane_preis_cent),
    fastlane_kontingent: eingabe.fastlane_kontingent,
    fastlane_beschreibung: eingabe.fastlane_beschreibung?.trim() || null,
    garderobe_aktiv: eingabe.garderobe_aktiv,
    garderobe_preis_cent: Math.max(0, eingabe.garderobe_preis_cent),
    garderobe_kontingent: eingabe.garderobe_kontingent,
    presale_ab: presaleAb,
    verkauf_ab: verkaufAb,
    veranstalter: "Lunar Events",
    geaendert_am: new Date().toISOString(),
  };
}

function deuteEventFehler(error: { message: string; code?: string }, slug: string): string {
  // Die Regel in der Tabelle lässt kein Kontingent unter die schon
  // verkauften Plätze sinken.
  if (error.message.includes("events_fastlane_gueltig")) {
    return "Das Fast-Lane-Kontingent ist kleiner als die schon verkauften Plätze.";
  }
  if (error.message.includes("events_garderobe_gueltig")) {
    return "Garderobe: Der Preis muss mindestens 0,50 € sein, und es darf nicht weniger Plätze geben als schon gebucht sind.";
  }
  if (error.message.includes("events_presale_gueltig")) {
    return "Der Presale muss vor dem öffentlichen Verkauf beginnen, und der Verkaufsstart muss gesetzt sein.";
  }
  if (error.code === "23505") return `Die Adresse „${slug}" ist schon vergeben.`;
  return error.message;
}

/** Welche Spalten ein Abschnitt der Übersicht schreiben darf. */
const ABSCHNITT_SPALTEN: Record<EventAbschnitt, string[]> = {
  grunddaten: ["slug", "titel", "untertitel", "teaser", "beschreibung", "kategorie"],
  wannwo: ["beginn", "einlass", "ende", "ort_id"],
  bild: ["bild_pfad", "bild_alt", "bild_fokus", "poster_statt_bild"],
  einlass: ["mindestalter", "dresscode", "lineup", "abendkasse", "abendkasse_hinweis", "streichpreis_cent"],
  fastlane: ["fastlane_aktiv", "fastlane_preis_cent", "fastlane_kontingent", "fastlane_beschreibung"],
  garderobe: ["garderobe_aktiv", "garderobe_preis_cent", "garderobe_kontingent"],
  verkauf: ["presale_ab", "verkauf_ab"],
  status: ["status", "featured"],
};

/**
 * Speichert einen Abschnitt eines bestehenden Events (Übersicht im
 * Backoffice, 13.10.2026). Gebaut wird dieselbe Zeile wie beim ganzen
 * Formular, geschrieben werden nur die Spalten dieses Abschnitts. Phasen
 * fasst diese Aktion nie an.
 */
export async function speichereEventTeil(
  eingabe: EventEingabe,
  teil: EventAbschnitt,
): Promise<SpeicherErgebnis> {
  if (!eingabe.id) return { ok: false, fehler: "Ein neues Event wird als Ganzes angelegt." };
  const spalten = ABSCHNITT_SPALTEN[teil];
  if (!spalten) return { ok: false, fehler: "Unbekannter Abschnitt." };
  const db = await serverClient();

  const slug = eingabe.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (teil === "grunddaten") {
    if (!slug) return { ok: false, fehler: "Die Adresse (Slug) fehlt." };
    if (!eingabe.titel.trim()) return { ok: false, fehler: "Der Titel fehlt." };
  }
  if (teil === "wannwo" && !eingabe.beginn) return { ok: false, fehler: "Der Beginn fehlt." };
  if (teil === "verkauf") {
    const presaleAb = eingabe.presale_ab ? berlinNachUtc(eingabe.presale_ab) : null;
    const verkaufAb = eingabe.verkauf_ab ? berlinNachUtc(eingabe.verkauf_ab) : null;
    if (presaleAb && !verkaufAb) {
      return { ok: false, fehler: "Für den Presale fehlt der öffentliche Verkaufsstart." };
    }
    if (presaleAb && verkaufAb && presaleAb >= verkaufAb) {
      return { ok: false, fehler: "Der Presale muss vor dem öffentlichen Verkauf beginnen." };
    }
  }

  let ortId = eingabe.ort_id;
  if (teil === "wannwo" && !ortId && eingabe.neuer_ort) {
    const { name, stadt, strasse, plz } = eingabe.neuer_ort;
    if (!name.trim() || !stadt.trim()) {
      return { ok: false, fehler: "Für einen neuen Ort brauchen wir Name und Stadt." };
    }
    const { data, error } = await db
      .from("orte")
      .insert({ name: name.trim(), stadt: stadt.trim(), strasse: strasse.trim() || null, plz: plz.trim() || null, land: "DE" })
      .select("id")
      .single();
    if (error) return { ok: false, fehler: `Ort anlegen: ${error.message}` };
    ortId = data.id;
  }
  if (teil === "wannwo" && !ortId) return { ok: false, fehler: "Es fehlt der Ort." };

  // Die ganze Zeile bauen (dieselben Umrechnungen wie beim Anlegen), dann
  // nur die Spalten dieses Abschnitts übernehmen.
  const ganz = eventZeile({ ...eingabe, beginn: eingabe.beginn || new Date().toISOString().slice(0, 16) }, slug, ortId ?? "");
  const zeile: Record<string, unknown> = { geaendert_am: ganz.geaendert_am };
  for (const s of spalten) zeile[s] = (ganz as Record<string, unknown>)[s];

  const { data: event, error } = await db
    .from("events")
    .update(zeile)
    .eq("id", eingabe.id)
    .select("id, slug")
    .maybeSingle();
  if (error) return { ok: false, fehler: deuteEventFehler(error, slug) };
  if (!event) return { ok: false, fehler: "Das dürfen nur Admins." };

  revalidatePath("/backoffice/events");
  revalidatePath("/backoffice/events/[slug]", "page");
  revalidatePath("/events");
  revalidatePath(`/events/${event.slug}`);
  revalidatePath("/");

  return { ok: true, slug: event.slug as string };
}

export async function holeOrte() {
  const db = await serverClient();
  const { data } = await db
    .from("orte")
    .select("id, name, stadt")
    .order("stadt");
  return (data ?? []) as Array<{ id: string; name: string; stadt: string }>;
}
