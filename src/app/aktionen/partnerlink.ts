"use server";

import { randomBytes } from "node:crypto";
import { serverClient } from "@/lib/supabase/server";

type Ergebnis = { ok: true } | { ok: false; fehler: string };

const NUR_ADMINS = "Nur Admins dürfen Partnerlinks ändern.";

/**
 * Partnerlink eines Events erzeugen oder erneuern (0047). Erneuern tauscht
 * den Schlüssel: Der alte Link liefert sofort 404. Ob jemand das darf, sagt
 * die Zugriffsregel (nur Admins), nicht die Oberfläche.
 */
export async function erzeugePartnerLink(eventId: string): Promise<Ergebnis> {
  const db = await serverClient();
  const { data, error } = await db
    .from("partner_links")
    .upsert(
      { event_id: eventId, token: randomBytes(32).toString("hex"), erstellt_am: new Date().toISOString() },
      { onConflict: "event_id" },
    )
    .select("event_id")
    .maybeSingle();

  if (error) return { ok: false, fehler: error.code === "42501" ? NUR_ADMINS : error.message };
  if (!data) return { ok: false, fehler: NUR_ADMINS };
  return { ok: true };
}

/** Partnerlink abschalten: Der Link liefert danach 404. */
export async function entfernePartnerLink(eventId: string): Promise<Ergebnis> {
  const db = await serverClient();
  const { data, error } = await db
    .from("partner_links")
    .delete()
    .eq("event_id", eventId)
    .select("event_id");

  if (error) return { ok: false, fehler: error.message };
  if (!data || data.length === 0) return { ok: false, fehler: NUR_ADMINS };
  return { ok: true };
}
