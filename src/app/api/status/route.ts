import { NextResponse } from "next/server";
import { datenbankVerbunden, serverClient } from "@/lib/supabase/server";
import { gefundeneNamen, verwandteNamen } from "@/lib/supabase/umgebung";

export const dynamic = "force-dynamic";

/**
 * Sagt, womit diese Auslieferung tatsächlich verbunden ist.
 *
 * Entstanden, nachdem die öffentliche Seite eine Weile Beispieldaten
 * anzeigte, weil in der Hosting-Umgebung die Zugangsdaten fehlten — von
 * außen war das nicht zu sehen, die Seite sah aus wie immer.
 *
 * Gibt ausschließlich Ja/Nein und Zählwerte zurück, niemals Schlüssel
 * oder Adressen.
 */
export async function GET() {
  const verbunden = datenbankVerbunden();

  let events: number | null = null;
  let datenbankFehler: string | null = null;

  if (verbunden) {
    try {
      const db = await serverClient();
      const { count, error } = await db
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("status", "veroeffentlicht");
      if (error) datenbankFehler = error.code ?? "unbekannt";
      else events = count ?? 0;
    } catch {
      datenbankFehler = "nicht_erreichbar";
    }
  }

  function schluesselArt(wert: string | undefined, testPraefix: string) {
    if (!wert) return "fehlt";
    return wert.startsWith(testPraefix) ? "test" : "live";
  }

  return NextResponse.json(
    {
      umgebung: process.env.NODE_ENV,
      datenbank: {
        zugangsdaten: verbunden,
        erreichbar: datenbankFehler === null && verbunden,
        fehler: datenbankFehler,
        veroeffentlichteEvents: events,
        dienstschluessel: Boolean(
          process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
        ),
        // Welche Variablennamen gefunden wurden — hilft, wenn in der
        // Hosting-Umgebung ein alter Name eingetragen ist.
        gefundeneNamen: gefundeneNamen(),
      },
      zahlung: {
        stripe: schluesselArt(process.env.STRIPE_SECRET_KEY, "sk_test_"),
        stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        paypal: process.env.PAYPAL_CLIENT_SECRET ? "eingerichtet" : "fehlt",
      },
      versand: {
        mail: Boolean(process.env.RESEND_API_KEY),
        wallet: Boolean(
          process.env.APPLE_WALLET_TEAM_ID || process.env.GOOGLE_WALLET_ISSUER_ID,
        ),
      },
      zeit: {
        serverZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        jetzt: new Date().toISOString(),
      },
      // Nur die Namen, nie die Werte. Zeigt, ob ein Schlüssel unter einer
      // unerwarteten Bezeichnung in der Umgebung steht.
      gesetzteVariablen: verwandteNamen(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
