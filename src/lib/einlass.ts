import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Der Draht des Scanners zur Datenbank (0048). Direkt aus dem Browser mit der
 * Anmeldung des Personals, nicht über Server-Aktionen: Die laufen in Next
 * nacheinander, und ein Scan wartete hinter jedem anderen Aufruf (beim
 * Nachtragen nach einem Netzausfall bis zu einer Minute). Direkt ist es
 * außerdem ein Weg weniger (Handy → Supabase statt Handy → Vercel → Supabase).
 * Was gültig ist, entscheidet weiter allein die Datenbank (`entwerte_ticket`).
 */

export type EinlassErgebnis = {
  ergebnis:
    | "gueltig"
    | "schon_entwertet"
    | "storniert"
    | "unbekannt"
    | "keine_berechtigung"
    | "anderes_event";
  event?: string;
  /** Beim anderen Event: wann es beginnt. */
  beginn?: string;
  typ?: string;
  art?: string;
  /** Darf an der normalen Schlange vorbei. */
  fastlane?: boolean;
  /** Name auf dem Ticket, für den Abgleich mit dem Ausweis (0046). */
  gast?: string | null;
  /** Gekauftes Ticket ohne Namen (Bestand von vor 0046). */
  name_fehlt?: boolean;
  platz?: string | null;
  zeitpunkt?: string;
  /** "Nur prüfen": nichts wurde entwertet. */
  probe?: boolean;
  /** Ohne Netz entschieden, wird nachgetragen. */
  gepuffert?: boolean;
};

/** Was das Gerät für den Betrieb ohne Netz hält: Prüfsummen und Namen. */
export type EinlassListe = {
  gueltig: string[];
  drin: string[];
  namen: Record<string, string>;
};

/**
 * So lange darf ein Scan dauern, dann entscheidet das Gerät aus seiner Liste.
 * Gemessen (Lasttest 14.10.): 57 ms im Mittel an der Datenbank, mit dem Weg
 * übers Handynetz meist unter einer halben Sekunde. Wer länger wartet, hat
 * schwaches Netz, und der Gast steht davor.
 */
export const ZEITGRENZE_MS = 3500;

/** Muss dasselbe liefern wie `einlass_pruefsumme()` in der Datenbank (0031). */
export async function pruefsumme(code: string): Promise<string> {
  const daten = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", daten);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function mitGrenze<T>(
  ms: number,
  anfrage: (signal: AbortSignal) => PromiseLike<{ data: T | null; error: unknown }>,
): Promise<T | null> {
  const ctrl = new AbortController();
  const uhr = setTimeout(() => ctrl.abort(), ms);
  try {
    const { data, error } = await anfrage(ctrl.signal);
    return error ? null : data;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * Ein Scan. `null` heißt: keine Antwort in der Zeit, das Gerät entscheidet
 * dann selbst. Beim Prüfen ohne Einlass wird das Event nicht verglichen,
 * damit sich jedes Ticket erklären lässt.
 */
export function scanne(
  db: SupabaseClient,
  code: string,
  eventId: string,
  nurPruefen: boolean,
): Promise<EinlassErgebnis | null> {
  return mitGrenze<EinlassErgebnis>(ZEITGRENZE_MS, (signal) =>
    db
      .rpc("entwerte_ticket", {
        p_code: code,
        p_event_id: nurPruefen ? null : eventId,
        p_nur_pruefen: nurPruefen,
      })
      .abortSignal(signal),
  );
}

export function holeListe(db: SupabaseClient, eventId: string): Promise<EinlassListe | null> {
  return mitGrenze<EinlassListe>(15000, (signal) =>
    db.rpc("einlass_liste", { p_event_id: eventId }).abortSignal(signal),
  );
}

export type Nachgetragen = {
  code: string;
  ergebnis: EinlassErgebnis["ergebnis"];
  gast: string | null;
  /** Schon drin, aber vom eigenen Konto: der Scan kam doch noch an. */
  eigenes: boolean;
};

export function trageNach(
  db: SupabaseClient,
  codes: string[],
  eventId: string | null,
): Promise<Nachgetragen[] | null> {
  return mitGrenze<Nachgetragen[]>(20000, (signal) =>
    db.rpc("einlass_nachtragen", { p_codes: codes, p_event_id: eventId }).abortSignal(signal),
  );
}
