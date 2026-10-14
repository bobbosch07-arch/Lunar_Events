"use server";

import { serverClient } from "@/lib/supabase/server";

// Der Scanner spricht seit 0048 direkt mit der Datenbank (src/lib/einlass.ts):
// Server-Aktionen laufen nacheinander, und ein Scan wartete hinter jedem
// anderen Aufruf, beim Nachtragen nach einem Netzausfall bis zu einer Minute.

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
