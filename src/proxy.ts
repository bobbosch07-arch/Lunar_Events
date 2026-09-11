import createMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const sprache = createMiddleware(routing);

/**
 * Zwei Aufgaben in einem Durchlauf:
 *
 * 1. Sprache bestimmen und gegebenenfalls umleiten (next-intl).
 * 2. Die Anmeldesitzung auffrischen. Ohne das läuft der Zugangstoken
 *    irgendwann ab, und der Gast wird mitten im Betrieb abgemeldet —
 *    Server-Komponenten können Cookies nämlich nicht selbst erneuern.
 *
 * Die Reihenfolge zählt: Erst die Antwort von next-intl holen, dann die
 * aufgefrischten Cookies hineinschreiben. Andersherum gingen sie
 * verloren.
 */
export default async function proxy(anfrage: NextRequest) {
  const antwort = sprache(anfrage);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const schluessel = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !schluessel) return antwort;

  const db = createServerClient(url, schluessel, {
    cookies: {
      getAll() {
        return anfrage.cookies.getAll();
      },
      setAll(gesetzte) {
        gesetzte.forEach(({ name, value, options }) => {
          antwort.cookies.set(name, value, options);
        });
      },
    },
  });

  // Der Aufruf selbst ist der Punkt: er erneuert den Token, falls nötig.
  await db.auth.getUser();

  return antwort;
}

export const config = {
  // Alles ausser Next-Interna, API-Routen und Dateien mit Endung.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
