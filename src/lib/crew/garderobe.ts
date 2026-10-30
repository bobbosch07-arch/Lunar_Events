import type {
  GarderobeAbgabe,
  GarderobeAusgabe,
  GarderobeRueckgaengig,
  GarderobeScan,
  MarkeInListe,
} from "@/app/aktionen/garderobe";
import type { browserClient } from "@/lib/supabase/client";

/**
 * Garderobe der Crew-App: dieselben Datenbank-Funktionen wie der Tresen
 * unter /garderobe (0027), nur direkt aus dem Browser statt über
 * Server-Aktionen (warum, steht in CLAUDE.md unter „Crew-App“).
 *
 * Null heißt: keine Antwort in der Zeit. Dann entscheidet der Tresen aus
 * seiner gespeicherten Liste, wie ohne Netz.
 */

type Db = ReturnType<typeof browserClient>;

/** Länger wartet am Tresen niemand. */
export const GARDEROBE_FRIST_MS = 6000;

async function rufe<T>(db: Db, funktion: string, parameter: Record<string, unknown>, ms = GARDEROBE_FRIST_MS) {
  const halt = new AbortController();
  const uhr = setTimeout(() => halt.abort(), ms);
  try {
    const { data, error } = await db.rpc(funktion, parameter).abortSignal(halt.signal);
    if (error) return null;
    return data as T;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

export function crewMarkeScannen(db: Db, code: string, eventId: string) {
  return rufe<GarderobeScan>(db, "garderobe_scan", { p_code: code.trim().toUpperCase(), p_event_id: eventId });
}

export function crewMarkeAbgeben(db: Db, id: string, nummer: string) {
  return rufe<GarderobeAbgabe>(db, "garderobe_abgeben", { p_id: id, p_nummer: nummer });
}

export function crewJackeAusgeben(db: Db, id: string) {
  return rufe<GarderobeAusgabe>(db, "garderobe_ausgeben", { p_id: id });
}

export function crewGarderobeZurueck(db: Db, id: string) {
  return rufe<GarderobeRueckgaengig>(db, "garderobe_rueckgaengig", { p_id: id });
}

export function crewMarken(db: Db, eventId: string) {
  return rufe<MarkeInListe[]>(db, "garderobe_liste", { p_event_id: eventId }, 15000);
}
