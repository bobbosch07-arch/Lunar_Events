"use server";

import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";

export type NewsletterErgebnis =
  | { ok: true }
  | { ok: false; fehler: "email" | "unbekannt" };

/**
 * Eintragen in den Verteiler.
 *
 * Antwortet auch dann mit „ok", wenn die Adresse schon drinsteht — wer
 * anders antwortet, verrät, welche Adressen bekannt sind. Das ist eine
 * Auskunft, die niemand erteilen sollte.
 *
 * Die Bestätigung per Mail (Double Opt-in) fehlt noch: Ohne sie darf
 * hier nichts verschickt werden. `bestaetigt` bleibt deshalb false, und
 * der Verteiler ist bis dahin nur eine Liste von Interessenten.
 */
export async function trageInVerteilerEin(
  email: string,
): Promise<NewsletterErgebnis> {
  const adresse = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(adresse)) {
    return { ok: false, fehler: "email" };
  }
  if (!datenbankVerbunden()) return { ok: false, fehler: "unbekannt" };

  const db = dienstClient();
  const { error } = await db
    .from("newsletter")
    .upsert({ email: adresse }, { onConflict: "email", ignoreDuplicates: true });

  if (error) {
    console.error("[newsletter] Eintragen fehlgeschlagen:", error.message);
    return { ok: false, fehler: "unbekannt" };
  }

  return { ok: true };
}
