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
