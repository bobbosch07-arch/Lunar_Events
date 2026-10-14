"use server";

import { dienstClient } from "@/lib/supabase/server";
import { bereinigeName, istTicketname } from "@/lib/ticketname";
import { darfAnschluss, GRENZEN } from "@/lib/drossel";

export type NamensErgebnis =
  | { ok: true; name: string }
  | {
      ok: false;
      grund: "name" | "doppelt" | "zu_spaet" | "nicht_gueltig" | "unbekannt" | "fehler";
    };

/**
 * Den Namen auf einem Ticket ändern oder nachtragen (0046), über die
 * Ticketseite. Nachweis ist der Ticketlink, wie für das Ticket selbst: Wer
 * ihn hat, kann das Ticket ohnehin nutzen oder weitergeben. Bis Eventbeginn;
 * was erlaubt ist, entscheidet `aendere_ticketname()` in der Datenbank.
 */
export async function aendereTicketname(
  token: string,
  code: string,
  roh: string,
): Promise<NamensErgebnis> {
  const name = bereinigeName(roh);
  if (!istTicketname(name)) return { ok: false, grund: "name" };
  if (typeof token !== "string" || typeof code !== "string" || token.length !== 64) {
    return { ok: false, grund: "unbekannt" };
  }
  if (!(await darfAnschluss("ticketnamen", GRENZEN.ticketnamen))) {
    return { ok: false, grund: "fehler" };
  }

  const { data, error } = await dienstClient().rpc("aendere_ticketname", {
    p_token: token,
    p_code: code,
    p_name: name,
  });
  if (error) {
    console.error("[ticketname] Ändern fehlgeschlagen:", error.message);
    return { ok: false, grund: "fehler" };
  }
  if (data !== "ok") {
    const grund = ["name", "doppelt", "zu_spaet", "nicht_gueltig"].includes(data as string)
      ? (data as "name" | "doppelt" | "zu_spaet" | "nicht_gueltig")
      : "unbekannt";
    return { ok: false, grund };
  }
  return { ok: true, name };
}
