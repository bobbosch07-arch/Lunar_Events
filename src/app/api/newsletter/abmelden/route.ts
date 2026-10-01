import { NextResponse } from "next/server";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";

const TOKEN = /^[0-9a-f]{16,128}$/;

/**
 * Ein-Klick-Abmeldung aus der Kopfzeile `List-Unsubscribe` (RFC 8058).
 *
 * Gmail und Apple Mail zeigen dafür einen eigenen Knopf und schicken dann
 * ein POST hierher, ohne dass der Gast eine Seite sieht. Ein Mailprogramm
 * ruft diese Adresse nicht für eine Vorschau auf (das wäre GET) — deshalb
 * darf hier, anders als auf `/newsletter/abmelden/<token>`, der Aufruf
 * selbst schon abmelden.
 */
export async function POST(anfrage: Request) {
  const token = new URL(anfrage.url).searchParams.get("t") ?? "";
  if (!TOKEN.test(token) || !datenbankVerbunden()) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { data, error } = await dienstClient().rpc("melde_newsletter_ab", { p_token: token });
  if (error) console.error("[newsletter] Ein-Klick-Abmeldung fehlgeschlagen:", error.message);
  return NextResponse.json({ ok: data === true });
}

/** Wer die Adresse im Browser öffnet, landet auf der Seite mit dem Knopf. */
export async function GET(anfrage: Request) {
  const token = new URL(anfrage.url).searchParams.get("t") ?? "";
  const ziel = TOKEN.test(token)
    ? `${eigeneAdresse()}/newsletter/abmelden/${token}`
    : eigeneAdresse();
  return NextResponse.redirect(ziel, 303);
}
