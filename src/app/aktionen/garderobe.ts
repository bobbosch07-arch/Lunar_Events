"use server";

import { serverClient } from "@/lib/supabase/server";
import type { GarderobeZustand } from "@/lib/typen";

/**
 * Der Garderobentresen (0027). Wie beim Einlass entscheidet die Datenbank —
 * hier wird nur durchgereicht, mit der Sitzung des Personals. Jede Funktion
 * dort prüft die Rolle selbst und antwortet immer, statt zu werfen.
 *
 * Geworfen wird hier nur bei einem Verbindungsfehler: Am Tresen muss klar
 * sein, dass das Netz das Problem ist und nicht die Marke. Der Tresen fällt
 * dann auf seine gespeicherte Liste zurück.
 */

export type MarkeInListe = {
  id: string;
  /** Prüfsumme des Codes — wie beim Einlass, nie der Code selbst. */
  summe: string;
  name: string | null;
  bestellnummer: string;
  nummer: string | null;
  zustand: GarderobeZustand;
};

export type GarderobeScan = {
  ergebnis:
    | "abgabe"
    | "abholung"
    | "gerade_abgegeben"
    | "schon_abgeholt"
    | "storniert"
    | "anderes_event"
    | "ticket"
    | "unbekannt"
    | "keine_berechtigung";
  id?: string;
  name?: string | null;
  nummer?: string;
  zeitpunkt?: string;
  event?: string;
};

export type GarderobeAbgabe = {
  ergebnis:
    | "ok"
    | "nummer"
    | "nummer_belegt"
    | "schon_abgegeben"
    | "storniert"
    | "unbekannt"
    | "keine_berechtigung";
  nummer?: string;
  name?: string | null;
  zustand?: GarderobeZustand;
};

export type GarderobeAusgabe = {
  ergebnis:
    | "abholung"
    | "schon_abgeholt"
    | "nicht_abgegeben"
    | "storniert"
    | "unbekannt"
    | "keine_berechtigung";
  nummer?: string;
  name?: string | null;
  zeitpunkt?: string;
};

export type GarderobeRueckgaengig = {
  ergebnis: "ok" | "nummer_belegt" | "nichts" | "unbekannt" | "keine_berechtigung";
  zustand?: GarderobeZustand;
  nummer?: string;
};

async function rufe<T>(funktion: string, parameter: Record<string, unknown>): Promise<T> {
  const db = await serverClient();
  const { data, error } = await db.rpc(funktion, parameter);
  if (error) {
    console.error(`[garderobe] ${funktion} fehlgeschlagen:`, error.message);
    throw new Error("verbindung");
  }
  return data as T;
}

export async function scanneMarke(code: string, eventId: string): Promise<GarderobeScan> {
  const sauber = code.trim().toUpperCase();
  if (!sauber) return { ergebnis: "unbekannt" };
  return rufe<GarderobeScan>("garderobe_scan", { p_code: sauber, p_event_id: eventId });
}

export async function gibMarkeAb(id: string, nummer: string): Promise<GarderobeAbgabe> {
  return rufe<GarderobeAbgabe>("garderobe_abgeben", { p_id: id, p_nummer: nummer });
}

export async function gibJackeAus(id: string): Promise<GarderobeAusgabe> {
  return rufe<GarderobeAusgabe>("garderobe_ausgeben", { p_id: id });
}

export async function macheRueckgaengig(id: string): Promise<GarderobeRueckgaengig> {
  return rufe<GarderobeRueckgaengig>("garderobe_rueckgaengig", { p_id: id });
}

/** Alle Marken eines Events — für die Suche und den Betrieb ohne Netz. */
export async function holeMarken(
  eventId: string,
): Promise<{ ok: boolean; marken: MarkeInListe[] }> {
  try {
    const marken = await rufe<MarkeInListe[]>("garderobe_liste", { p_event_id: eventId });
    return { ok: true, marken: marken ?? [] };
  } catch {
    return { ok: false, marken: [] };
  }
}
