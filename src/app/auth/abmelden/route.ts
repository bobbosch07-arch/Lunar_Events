import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_OEFFENTLICH } from "@/lib/supabase/umgebung";

export const dynamic = "force-dynamic";

/**
 * Beendet eine abgelaufene Personal-Sitzung und schickt zur Anmeldung.
 *
 * Eine Route und keine Server-Komponente, weil nur hier Cookies gelöscht
 * werden dürfen. Das Backoffice und der Einlass leiten hierher um, sobald
 * die Anmeldung älter ist als erlaubt (src/lib/sitzung.ts).
 */
export async function GET(anfrage: NextRequest) {
  const { searchParams, origin } = new URL(anfrage.url);
  const weiter = searchParams.get("weiter") ?? "/backoffice";
  // Nur eigene Pfade, wie bei /auth/bestaetigen.
  const ziel = weiter.startsWith("/") && !weiter.startsWith("//") ? weiter : "/backoffice";

  const store = await cookies();
  const db = createServerClient(SUPABASE_URL!, SUPABASE_OEFFENTLICH!, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(gesetzte) {
        gesetzte.forEach(({ name, value, options }) => store.set(name, value, options));
      },
    },
  });

  // Nur diese Sitzung, nicht die auf anderen Geräten.
  await db.auth.signOut({ scope: "local" });

  return NextResponse.redirect(`${origin}${ziel}?abgelaufen=1`);
}
