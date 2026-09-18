"use server";

import { serverClient } from "@/lib/supabase/server";

export type EinlassErgebnis = {
  ergebnis:
    | "gueltig"
    | "schon_entwertet"
    | "storniert"
    | "unbekannt"
    | "keine_berechtigung";
  event?: string;
  typ?: string;
  art?: string;
  /** Darf an der normalen Schlange vorbei. */
  fastlane?: boolean;
  gast?: string | null;
  platz?: string | null;
  zeitpunkt?: string;
};

/**
 * Entwertet ein Ticket. Die eigentliche Prüfung macht die Datenbank —
 * hier wird nur durchgereicht, damit niemand am Gerät entscheidet, was
 * gültig ist.
 */
export async function entwerte(code: string): Promise<EinlassErgebnis> {
  const sauber = code.trim().toUpperCase();
  if (!sauber) return { ergebnis: "unbekannt" };

  const db = await serverClient();
  const { data, error } = await db.rpc("entwerte_ticket", { p_code: sauber });

  if (error) {
    console.error("[einlass] Entwerten fehlgeschlagen:", error.message);
    // Kein stilles "ungültig": am Eingang muss klar sein, dass die
    // Verbindung das Problem ist und nicht das Ticket.
    throw new Error("verbindung");
  }

  return data as EinlassErgebnis;
}

/**
 * Prüfsummen aller gültigen Tickets eines Events, für den Betrieb ohne Netz.
 *
 * Bewusst Prüfsummen statt der Codes selbst: Damit kann das Gerät sagen
 * „dieser Code gehört zu diesem Event", aber niemand kann aus einem
 * verlorenen Telefon Tickets herstellen.
 */
export async function holePruefsummen(
  eventId: string,
): Promise<{ ok: boolean; summen: string[] }> {
  const db = await serverClient();
  const { data, error } = await db
    .from("tickets")
    .select("code")
    .eq("event_id", eventId)
    .eq("status", "gueltig");

  if (error || !data) {
    console.error("[einlass] Prüfsummen laden fehlgeschlagen:", error?.message);
    return { ok: false, summen: [] };
  }

  const summen = await Promise.all(
    data.map((z) => pruefsumme(z.code as string)),
  );
  return { ok: true, summen };
}

/** Muss auf Server und Gerät dasselbe Ergebnis liefern. */
async function pruefsumme(code: string): Promise<string> {
  const daten = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", daten);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Gästeliste (0021)                                                   */
/* ------------------------------------------------------------------ */

export type GastEintrag = {
  id: string;
  name: string;
  notiz: string | null;
  /** VIP-Gast (0028) — dann steht sein Platz in `tisch`. */
  vip?: boolean;
  tisch?: string | null;
  /** Personen mit gültigem oder eingelöstem Ticket */
  personen: number;
  drin: number;
};

export type GastEinlass = {
  ergebnis: "gueltig" | "schon_drin" | "storniert" | "unbekannt" | "keine_berechtigung";
  name?: string;
  eingelassen?: number;
  personen?: number;
  drin?: number;
};

/**
 * Die Namensliste eines Events — ohne Mailadressen. Ohne Einlass-Rolle
 * liefert die Datenbank eine leere Liste.
 */
export async function holeGaesteliste(
  eventId: string,
): Promise<{ ok: boolean; gaeste: GastEintrag[] }> {
  const db = await serverClient();
  const { data, error } = await db.rpc("gaesteliste_einlass", { p_event_id: eventId });
  if (error) {
    console.error("[einlass] Gästeliste laden fehlgeschlagen:", error.message);
    return { ok: false, gaeste: [] };
  }
  return { ok: true, gaeste: (data ?? []) as GastEintrag[] };
}

/**
 * Lässt Personen eines Eintrags über die Namensliste ein. Entwertet werden
 * dieselben Tickets wie beim QR-Scan — doppelt rein geht nicht.
 */
export async function lasseGastEin(gastId: string, anzahl: number): Promise<GastEinlass> {
  const db = await serverClient();
  const { data, error } = await db.rpc("lasse_gast_ein", {
    p_gast_id: gastId,
    p_anzahl: Math.max(1, Math.floor(anzahl)),
  });
  if (error) {
    console.error("[einlass] Gast einlassen fehlgeschlagen:", error.message);
    // Wie beim Scan: am Eingang muss klar sein, dass die Verbindung das
    // Problem ist und nicht der Gast.
    throw new Error("verbindung");
  }
  return data as GastEinlass;
}
