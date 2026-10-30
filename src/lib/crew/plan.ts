import type { browserClient } from "@/lib/supabase/client";
import type { Rolle } from "@/lib/rollen";

/** Eine eigene Schicht, wie `meine_schichten()` (0051) sie liefert. */
export type CrewSchicht = {
  id: string;
  /** Rolle an der Schicht — kann von der Rolle der Person abweichen. */
  rolle: Rolle;
  station: string | null;
  beginn: string;
  ende: string;
  pause_min: number;
  notiz: string | null;
  eingecheckt_am: string | null;
  ausgecheckt_am: string | null;
  stunden: number;
  event: { titel: string; beginn: string; ort: string | null };
};

/** Null heißt: keine Antwort — dann gilt der gespeicherte Plan weiter. */
export async function crewMeineSchichten(db: ReturnType<typeof browserClient>): Promise<CrewSchicht[] | null> {
  const halt = new AbortController();
  const uhr = setTimeout(() => halt.abort(), 8000);
  try {
    const { data, error } = await db.rpc("meine_schichten").abortSignal(halt.signal);
    if (error || !Array.isArray(data)) return null;
    return data as CrewSchicht[];
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}
