import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Ist überhaupt eine Datenbank hinterlegt? */
export function datenbankVerbunden(): boolean {
  return Boolean(URL && PUBLIC_KEY);
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
  const schluessel = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!schluessel) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt — ohne ihn können Zahlungen nicht bestätigt werden.",
    );
  }
  return createClient(URL!, schluessel, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
