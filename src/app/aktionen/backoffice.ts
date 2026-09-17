"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { bedieneWarteliste } from "@/lib/warteliste";

/**
 * Änderungen aus dem Backoffice laufen über die Sitzung des Mitarbeiters.
 * Wer hier nichts darf, kommt auch mit einem manipulierten Aufruf nicht
 * weiter — die Zugriffsregeln entscheiden, nicht diese Datei.
 */

const ANFRAGE_STATUS = [
  "neu",
  "in_bearbeitung",
  "angebot",
  "bestaetigt",
  "abgelehnt",
] as const;

export async function setzeVipStatus(id: string, status: string) {
  if (!ANFRAGE_STATUS.includes(status as (typeof ANFRAGE_STATUS)[number])) {
    return { ok: false as const, fehler: "unbekannter_status" };
  }

  const db = await serverClient();
  const { error } = await db.from("vip_anfragen").update({ status }).eq("id", id);

  if (error) {
    console.error("[backoffice] VIP-Status setzen fehlgeschlagen:", error.message);
    return { ok: false as const, fehler: error.message };
  }

  revalidatePath("/backoffice/vip");
  return { ok: true as const };
}

export async function speichereVipNotiz(id: string, notiz: string) {
  const db = await serverClient();
  const { error } = await db
    .from("vip_anfragen")
    .update({ notiz_intern: notiz.trim() || null })
    .eq("id", id);

  if (error) return { ok: false as const, fehler: error.message };
  revalidatePath("/backoffice/vip");
  return { ok: true as const };
}

/**
 * Gibt Kontingente aus abgelaufenen Reservierungen frei.
 *
 * Solange kein geplanter Auftrag läuft, ist das der Knopf dafür — besser
 * ein Knopf, den jemand drückt, als blockierte Plätze, die niemand sieht.
 */
export async function raeumeReservierungenAuf() {
  const db = await serverClient();
  const { data, error } = await db.rpc("raeume_reservierungen_auf");

  if (error) {
    console.error("[backoffice] Aufräumen fehlgeschlagen:", error.message);
    return { ok: false as const, fehler: error.message };
  }

  // Was frei wurde, gehört zuerst der Warteliste — wie im Takt.
  await bedieneWarteliste();

  revalidatePath("/backoffice");
  revalidatePath("/backoffice/bestellungen");
  return { ok: true as const, anzahl: (data as number) ?? 0 };
}

export async function setzeEventStatus(id: string, status: string) {
  const erlaubt = ["entwurf", "veroeffentlicht", "abgesagt", "archiviert"];
  if (!erlaubt.includes(status)) {
    return { ok: false as const, fehler: "unbekannter_status" };
  }

  const db = await serverClient();
  const { error } = await db
    .from("events")
    .update({ status, geaendert_am: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[backoffice] Eventstatus setzen fehlgeschlagen:", error.message);
    return { ok: false as const, fehler: error.message };
  }

  revalidatePath("/backoffice/events");
  revalidatePath("/events");
  return { ok: true as const };
}
