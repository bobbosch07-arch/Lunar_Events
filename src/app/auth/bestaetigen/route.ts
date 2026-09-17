import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_OEFFENTLICH } from "@/lib/supabase/umgebung";
import { meldeAnmeldung } from "@/lib/anmeldemeldung";

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
  // Supabase schickt je nach Weg entweder einen "code" (der Browser hat
  // beim Anfordern ein Gegenstück hinterlegt) oder einen "token_hash"
  // (der steht für sich allein). Nur der zweite funktioniert auch dann,
  // wenn der Link in einem anderen Browser geöffnet wird als dem, der
  // ihn angefordert hat — oder wenn er gar nicht angefordert, sondern
  // von der Veranstaltungsleitung ausgestellt wurde.
  const tokenHash = searchParams.get("token_hash");
  const art = (searchParams.get("type") ?? "magiclink") as
    | "magiclink"
    | "email"
    | "recovery"
    | "invite";
  const weiter = searchParams.get("weiter") ?? "/konto/tickets";

  // Nur eigene Pfade, keine fremden Adressen: sonst ließe sich der
  // Anmeldelink missbrauchen, um Leute woandershin zu schicken.
  const ziel = weiter.startsWith("/") && !weiter.startsWith("//") ? weiter : "/konto";

  if (!code && !tokenHash) {
    return NextResponse.redirect(`${origin}/konto?fehler=kein_code`);
  }

  const store = await cookies();
  const db = createServerClient(
    SUPABASE_URL!,
    SUPABASE_OEFFENTLICH!,
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

  const { error } = tokenHash
    ? await db.auth.verifyOtp({ token_hash: tokenHash, type: art })
    : await db.auth.exchangeCodeForSession(code!);

  if (error) {
    console.error("[auth] Anmeldung fehlgeschlagen:", error.message);
    return NextResponse.redirect(`${origin}/konto?fehler=abgelaufen`);
  }

  // Gemeldet werden nur Anmeldungen von Admins — bei Gästen wäre es Lärm.
  const { data: nutzer } = await db.auth.getUser();
  if (nutzer.user) await meldeAnmeldung(nutzer.user.id, "Anmeldelink");

  return NextResponse.redirect(`${origin}${ziel}`);
}
