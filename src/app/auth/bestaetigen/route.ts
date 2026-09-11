import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * Hier landet der Anmeldelink aus der E-Mail.
 *
 * Der Link enthält einen einmaligen Code, den wir gegen eine Sitzung
 * tauschen. Danach leiten wir weiter — voreingestellt zu den eigenen
 * Tickets, denn deswegen meldet sich hier fast jeder an.
 */
export async function GET(anfrage: NextRequest) {
  const { searchParams, origin } = new URL(anfrage.url);
  const code = searchParams.get("code");
  const weiter = searchParams.get("weiter") ?? "/konto/tickets";

  // Nur eigene Pfade, keine fremden Adressen: sonst ließe sich der
  // Anmeldelink missbrauchen, um Leute woandershin zu schicken.
  const ziel = weiter.startsWith("/") && !weiter.startsWith("//") ? weiter : "/konto";

  if (!code) {
    return NextResponse.redirect(`${origin}/konto?fehler=kein_code`);
  }

  const store = await cookies();
  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(gesetzte) {
          gesetzte.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        },
      },
    },
  );

  const { error } = await db.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] Anmeldung fehlgeschlagen:", error.message);
    return NextResponse.redirect(`${origin}/konto?fehler=abgelaufen`);
  }

  return NextResponse.redirect(`${origin}${ziel}`);
}
