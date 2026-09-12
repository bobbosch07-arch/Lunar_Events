import { NextResponse, type NextRequest } from "next/server";
import { googleEingerichtet, speicherLink, stelleClassSicher } from "@/lib/wallet/google";
import { ladePassDaten } from "@/lib/wallet/laden";
import { dienstClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Leitet zum Speichern-Dialog von Google weiter.
 *
 * Die Class wird beim ersten Ticket eines Events angelegt. Das kostet
 * einmal eine kurze Wartezeit, spart aber einen Pflegeschritt beim
 * Anlegen eines Events — und ein Event ohne verkaufte Tickets braucht
 * gar keine Class.
 */
export async function GET(anfrage: NextRequest) {
  if (!googleEingerichtet()) {
    return NextResponse.json(
      { fehler: "Google Wallet ist nicht eingerichtet." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(anfrage.url);
  const code = searchParams.get("code");
  const token = searchParams.get("t");

  if (!code || !token) {
    return NextResponse.json({ fehler: "Unvollständig" }, { status: 400 });
  }

  const geladen = await ladePassDaten(code, token);
  if (!geladen) {
    return NextResponse.json({ fehler: "Nicht gefunden" }, { status: 404 });
  }

  try {
    const { daten, eventId } = geladen;

    const db = dienstClient();
    const { data: event } = await db
      .from("events")
      .select("id, titel, beginn, einlass, ort:orte(name, stadt, strasse)")
      .eq("id", eventId)
      .single();

    if (event) {
      const ort = event.ort as unknown as {
        name: string;
        stadt: string;
        strasse: string | null;
      };
      await stelleClassSicher({
        id: event.id as string,
        titel: event.titel as string,
        beginn: event.beginn as string,
        einlass: (event.einlass as string | null) ?? null,
        ortName: ort.name,
        ortStadt: ort.stadt,
        ortStrasse: ort.strasse,
      });
    }

    return NextResponse.redirect(speicherLink(daten, eventId));
  } catch (fehler) {
    console.error("[wallet] Google-Pass fehlgeschlagen:", (fehler as Error).message);
    return NextResponse.json(
      { fehler: "Der Pass konnte nicht erstellt werden." },
      { status: 500 },
    );
  }
}
