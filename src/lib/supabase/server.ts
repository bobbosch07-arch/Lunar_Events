import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  SUPABASE_URL,
  SUPABASE_OEFFENTLICH,
  SUPABASE_GEHEIM,
  zugangVorhanden,
} from "./umgebung";

const URL = SUPABASE_URL;
const PUBLIC_KEY = SUPABASE_OEFFENTLICH;

/** Ist überhaupt eine Datenbank hinterlegt? */
export function datenbankVerbunden(): boolean {
  return zugangVorhanden();
}

/**
 * Für Server-Komponenten und Route-Handler. Liest die Sitzung aus den
 * Cookies, unterliegt also den Zugriffsregeln der angemeldeten Person.
 */
export async function serverClient() {
  const store = await cookies();

  return createServerClient(URL!, PUBLIC_KEY!, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(gesetzte) {
        try {
          gesetzte.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // In Server-Komponenten lässt sich nichts setzen. Das ist in
          // Ordnung, solange eine Middleware die Sitzung auffrischt.
        }
      },
    },
  });
}

/**
 * Umgeht ALLE Zugriffsregeln. Nur dort benutzen, wo es keinen anderen Weg
 * gibt — Zahlungsbestätigungen vom Anbieter, die Bestätigungsseite eines
 * Gastkaufs, Aufräumläufe. Niemals in einer Client-Komponente importieren.
 */
export function dienstClient() {
  const schluessel = SUPABASE_GEHEIM;
  if (!schluessel) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt — ohne ihn können Zahlungen nicht bestätigt werden.",
    );
  }
  return createClient(URL!, schluessel, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next legt gleiche GET-Anfragen innerhalb eines Seitenaufbaus zusammen
    // (Request Memoization). Für die Datenbank ist das falsch: Wer liest,
    // bestätigt und wieder liest, bekommt beim zweiten Mal die alte Antwort.
    // So zeigte die Ticketseite nach dem Nachbuchen die neue Garderobenmarke
    // erst beim Neuladen, und die Tür-Zahlseite „offen" statt „bezahlt".
    // Ein eigenes Abbruchsignal je Anfrage schaltet das ab.
    global: {
      fetch: (eingabe, optionen) =>
        fetch(eingabe, { ...optionen, signal: optionen?.signal ?? new AbortController().signal }),
    },
  });
}
