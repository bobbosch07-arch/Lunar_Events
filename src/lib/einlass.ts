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

// ---------- Crew-App: prüfen, dann entscheiden (0049) ----------

/**
 * Antwort der Crew-Funktionen. Anders als beim alten Scan entwertet erst
 * `reinlassen`; `pruefen` sagt nur, ob das Ticket gültig wäre. `drin` ist der
 * Stand des Events nach der Aktion (Server, nicht das Gerät).
 */
export type CrewErgebnis = Omit<EinlassErgebnis, "ergebnis"> & {
  ergebnis:
    | EinlassErgebnis["ergebnis"]
    | "drin"
    | "zurueck"
    | "nicht_drin"
    | "nicht_erlaubt"
    | "kein_event";
  drin?: number;
  /** Schon drin, und zwar vom eigenen Konto eingelassen. */
  eigenes?: boolean;
};

export type CrewStand = {
  ergebnis: "ok" | "keine_berechtigung";
  drin?: number;
  kapazitaet?: number | null;
  modus?: "automatisch" | "entscheiden";
};

export function crewPruefen(db: SupabaseClient, code: string, eventId: string) {
  return mitGrenze<CrewErgebnis>(ZEITGRENZE_MS, (signal) =>
    db.rpc("einlass_pruefen", { p_code: code, p_event_id: eventId }).abortSignal(signal),
  );
}

export function crewReinlassen(db: SupabaseClient, code: string, eventId: string) {
  return mitGrenze<CrewErgebnis>(ZEITGRENZE_MS, (signal) =>
    db.rpc("einlass_reinlassen", { p_code: code, p_event_id: eventId }).abortSignal(signal),
  );
}

export function crewRueckgaengig(db: SupabaseClient, code: string, eventId: string) {
  return mitGrenze<CrewErgebnis>(ZEITGRENZE_MS, (signal) =>
    db.rpc("einlass_rueckgaengig", { p_code: code, p_event_id: eventId }).abortSignal(signal),
  );
}

export function crewStand(db: SupabaseClient, eventId: string) {
  return mitGrenze<CrewStand>(ZEITGRENZE_MS, (signal) =>
    db.rpc("einlass_stand_abrufen", { p_event_id: eventId }).abortSignal(signal),
  );
}

/** Eine ohne Netz getroffene Entscheidung, in der Reihenfolge am Gerät. */
export type CrewAktion = { code: string; aktion: "rein" | "zurueck"; zeit: number; eventId: string };

export type CrewNachgetragen = {
  ergebnis: "ok" | "keine_berechtigung";
  liste?: (Nachgetragen & { aktion: CrewAktion["aktion"] })[];
  drin?: number;
};

export function crewTrageNach(db: SupabaseClient, aktionen: CrewAktion[], eventId: string) {
  return mitGrenze<CrewNachgetragen>(20000, (signal) =>
    db
      .rpc("einlass_nachtragen_aktionen", {
        p_aktionen: aktionen.map(({ code, aktion }) => ({ code, aktion })),
        p_event_id: eventId,
      })
      .abortSignal(signal),
  );
}

// ---------- Crew-App: Gästeliste (0021, direkt statt über Server-Aktionen) ----------

/**
 * Dieselben Funktionen wie `holeGaesteliste`/`lasseGastEin` in
 * aktionen/einlass.ts, aber direkt aus dem Browser: Die Crew-App liegt im
 * Speicher des Geräts, und eine Server-Aktion aus einer älteren Fassung
 * findet der Server nach dem nächsten Deploy nicht mehr.
 */
export type CrewGast = {
  id: string;
  name: string;
  notiz: string | null;
  vip?: boolean;
  tisch?: string | null;
  personen: number;
  drin: number;
};

export type CrewGastEinlass = {
  ergebnis: "gueltig" | "schon_drin" | "storniert" | "unbekannt" | "keine_berechtigung";
  name?: string;
  eingelassen?: number;
  personen?: number;
  drin?: number;
};

export function crewGaeste(db: SupabaseClient, eventId: string) {
  return mitGrenze<CrewGast[]>(15000, (signal) =>
    db.rpc("gaesteliste_einlass", { p_event_id: eventId }).abortSignal(signal),
  );
}

export function crewGastEin(db: SupabaseClient, gastId: string, anzahl: number) {
  return mitGrenze<CrewGastEinlass>(ZEITGRENZE_MS, (signal) =>
    db
      .rpc("lasse_gast_ein", { p_gast_id: gastId, p_anzahl: Math.max(1, Math.floor(anzahl)) })
      .abortSignal(signal),
  );
}
