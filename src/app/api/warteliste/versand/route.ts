import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { versendeAngebote } from "@/lib/warteliste";

/**
 * Verschickt die Mails zu neuen Warteliste-Angeboten.
 *
 * Aufgerufen vom Takt in der Datenbank (lunar_takt, pg_net), sobald
 * Angebote auf ihre Mail warten. Der Schlüssel liegt nur in der Datenbank
 * (Tabelle betrieb) — nicht im Repository und nicht in Vercel, also muss
 * niemand ihn von Hand übertragen. Auch ohne Schlüssel richtete ein Aufruf
 * wenig an, denn es gehen nur Mails raus, die ohnehin fällig sind.
 */
export async function POST(anfrage: Request) {
  if (!datenbankVerbunden()) {
    return NextResponse.json({ fehler: "keine_datenbank" }, { status: 503 });
  }

  const db = dienstClient();
  const { data } = await db
    .from("betrieb")
    .select("wert")
    .eq("schluessel", "versand_schluessel")
    .maybeSingle();

  const erwartet = Buffer.from((data?.wert as string | undefined) ?? "");
  const geschickt = Buffer.from(anfrage.headers.get("x-lunar-schluessel") ?? "");
  if (
    erwartet.length === 0 ||
    erwartet.length !== geschickt.length ||
    !timingSafeEqual(erwartet, geschickt)
  ) {
    return NextResponse.json({ fehler: "nicht_berechtigt" }, { status: 401 });
  }

  const ergebnis = await versendeAngebote();
  return NextResponse.json(ergebnis);
}
