"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { berlinNachUtc } from "@/lib/zeit";
import { CODE_MUSTER, normalisiereCode } from "@/lib/rabatt";
import type { RabattArt } from "@/lib/typen";

/**
 * Rabattcodes pflegen. Läuft über die Sitzung — ob jemand darf, entscheidet
 * die Zugriffsregel (nur Admins), nicht diese Datei. Die Prüfungen hier sind
 * dafür da, verständliche Sätze statt Datenbankmeldungen zu liefern.
 */

export type RabattcodeEingabe = {
  id?: string;
  code: string;
  art: RabattArt;
  /** Prozent als ganze Zahl oder Cent je Ticket */
  wert: number;
  event_id: string | null;
  phasen_ids: string[];
  /** Ortszeit aus dem Formular, z. B. "2026-10-01T18:00" */
  gueltig_ab: string | null;
  gueltig_bis: string | null;
  max_tickets: number | null;
  einmal_pro_person: boolean;
  aktiv: boolean;
  notiz: string | null;
};

export type CodeSpeicherErgebnis = { ok: true; id: string } | { ok: false; fehler: string };

const NUR_ADMINS = "Rabattcodes dürfen nur Admins anlegen, ändern oder löschen.";

export async function speichereRabattcode(
  eingabe: RabattcodeEingabe,
): Promise<CodeSpeicherErgebnis> {
  const code = normalisiereCode(eingabe.code);
  if (!CODE_MUSTER.test(code)) {
    return {
      ok: false,
      fehler:
        "Der Code braucht 3 bis 32 Zeichen: Buchstaben ohne Umlaute, Ziffern, Bindestrich oder Unterstrich.",
    };
  }
  if (!Number.isInteger(eingabe.wert) || eingabe.wert <= 0) {
    return { ok: false, fehler: "Der Rabatt muss größer als 0 sein." };
  }
  if (eingabe.art === "prozent" && eingabe.wert > 100) {
    return { ok: false, fehler: "Mehr als 100 % geht nicht." };
  }
  if (
    eingabe.max_tickets !== null &&
    (!Number.isInteger(eingabe.max_tickets) || eingabe.max_tickets <= 0)
  ) {
    return { ok: false, fehler: "Die Obergrenze muss eine ganze Zahl über 0 sein — oder leer." };
  }

  const gueltigAb = eingabe.gueltig_ab ? berlinNachUtc(eingabe.gueltig_ab) : null;
  const gueltigBis = eingabe.gueltig_bis ? berlinNachUtc(eingabe.gueltig_bis) : null;
  if (gueltigAb && gueltigBis && gueltigAb >= gueltigBis) {
    return { ok: false, fehler: "„Gültig bis“ liegt vor „Gültig ab“." };
  }

  const zeile = {
    code,
    art: eingabe.art,
    wert: eingabe.wert,
    event_id: eingabe.event_id,
    // Phasen gehören zu genau einem Event. Ohne Event wären sie bedeutungslos.
    phasen_ids:
      eingabe.event_id && eingabe.phasen_ids.length > 0 ? eingabe.phasen_ids : null,
    gueltig_ab: gueltigAb,
    gueltig_bis: gueltigBis,
    max_tickets: eingabe.max_tickets,
    einmal_pro_person: eingabe.einmal_pro_person,
    aktiv: eingabe.aktiv,
    notiz: eingabe.notiz?.trim() || null,
  };

  const db = await serverClient();
  const { data, error } = eingabe.id
    ? await db.from("rabattcodes").update(zeile).eq("id", eingabe.id).select("id").maybeSingle()
    : await db.from("rabattcodes").insert(zeile).select("id").maybeSingle();

  if (error) {
    if (error.code === "23505") return { ok: false, fehler: `Den Code „${code}“ gibt es schon.` };
    if (error.message.includes("rabattcodes_grenze")) {
      return {
        ok: false,
        fehler:
          "Die Obergrenze liegt unter den schon eingelösten Tickets. Laufende Reservierungen zählen mit.",
      };
    }
    if (error.code === "42501" || error.message.includes("row-level security")) {
      return { ok: false, fehler: NUR_ADMINS };
    }
    console.error("[rabattcodes] Speichern fehlgeschlagen:", error.message);
    return { ok: false, fehler: error.message };
  }
  // Eine Änderung ohne Recht trifft keine Zeile, statt einen Fehler zu werfen.
  if (!data) return { ok: false, fehler: NUR_ADMINS };

  revalidatePath("/backoffice/rabattcodes");
  return { ok: true, id: data.id as string };
}

/**
 * Löscht einen Code. Bestellungen, die ihn benutzt haben, behalten Code und
 * Rabatt — beides ist in die Bestellung kopiert.
 */
export async function loescheRabattcode(
  id: string,
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const db = await serverClient();
  const { data, error } = await db.from("rabattcodes").delete().eq("id", id).select("id");

  if (error) {
    console.error("[rabattcodes] Löschen fehlgeschlagen:", error.message);
    return { ok: false, fehler: error.message };
  }
  if (!data || data.length === 0) return { ok: false, fehler: NUR_ADMINS };

  revalidatePath("/backoffice/rabattcodes");
  return { ok: true };
}
