import { NextResponse, type NextRequest } from "next/server";
import { appleEingerichtet, erzeugeApplePass } from "@/lib/wallet/apple";
import { ladePassDaten } from "@/lib/wallet/laden";

export const dynamic = "force-dynamic";

/**
 * Liefert eine .pkpass-Datei. Der Browser gibt sie an Wallet weiter,
 * sobald der Inhaltstyp stimmt — deshalb ist der Header hier keine
 * Nebensache, sondern der ganze Mechanismus.
 */
export async function GET(anfrage: NextRequest) {
  if (!appleEingerichtet()) {
    return NextResponse.json(
      { fehler: "Apple Wallet ist nicht eingerichtet." },
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
    const pass = await erzeugeApplePass(geladen.daten);

    return new NextResponse(new Uint8Array(pass), {
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `attachment; filename="lunar-${geladen.daten.code}.pkpass"`,
        // Ein Pass gehört genau einer Person — nichts davon in einen
        // gemeinsamen Zwischenspeicher.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (fehler) {
    console.error("[wallet] Apple-Pass fehlgeschlagen:", (fehler as Error).message);
    return NextResponse.json(
      { fehler: "Der Pass konnte nicht erstellt werden." },
      { status: 500 },
    );
  }
}
