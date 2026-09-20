import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { sendeErinnerung, versandEingerichtet } from "@/lib/mail";
import { berlinerZeit } from "@/lib/warteliste";
import { eigeneAdresse } from "@/lib/stripe";

/**
 * Verschickt die Erinnerungsmails (C6), einen Tag vor dem Event.
 *
 * Angestoßen vom Takt in der Datenbank (`stosse_erinnerung_an`, pg_net),
 * sobald ein Event in den nächsten 24 Stunden beginnt und noch bezahlte
 * Bestellungen ohne Erinnerung hat. Der Schlüssel liegt nur in der
 * Datenbank (Tabelle betrieb), also muss ihn niemand von Hand übertragen.
 *
 * Je Bestellung genau eine Mail: `erinnerung_am` wird gesetzt, sobald sie
 * raus ist. Scheitert der Versand, bleibt das Feld leer und der nächste
 * Takt versucht es erneut.
 */

/** Karten-Link aus der Adresse, ohne Personenbezug. */
function karteAus(ort: {
  name: string;
  strasse: string | null;
  plz: string | null;
  stadt: string;
}): string | null {
  if (!ort.strasse) return null;
  const adresse = [ort.name, ort.strasse, `${ort.plz ?? ""} ${ort.stadt}`.trim()]
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(adresse)}`;
}

function ortText(ort: {
  name: string;
  strasse: string | null;
  plz: string | null;
  stadt: string;
}): string {
  return [ort.name, ort.strasse, `${ort.plz ?? ""} ${ort.stadt}`.trim()]
    .filter(Boolean)
    .join(", ");
}

export async function POST(anfrage: Request) {
  if (!datenbankVerbunden()) {
    return NextResponse.json({ fehler: "keine_datenbank" }, { status: 503 });
  }

  const db = dienstClient();
  const { data: schluessel } = await db
    .from("betrieb")
    .select("wert")
    .eq("schluessel", "versand_schluessel")
    .maybeSingle();

  const erwartet = Buffer.from((schluessel?.wert as string | undefined) ?? "");
  const geschickt = Buffer.from(anfrage.headers.get("x-lunar-schluessel") ?? "");
  if (
    erwartet.length === 0 ||
    erwartet.length !== geschickt.length ||
    !timingSafeEqual(erwartet, geschickt)
  ) {
    return NextResponse.json({ fehler: "nicht_berechtigt" }, { status: 401 });
  }

  if (!versandEingerichtet()) {
    return NextResponse.json({ fehler: "kein_versand" }, { status: 503 });
  }

  const jetzt = new Date();
  const grenze = new Date(jetzt.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Bezahlte Bestellungen ohne Erinnerung, deren Event in den naechsten
  // 24 Stunden beginnt. Der Filter aufs Event laeuft ueber !inner.
  const { data: bestellungen, error } = await db
    .from("bestellungen")
    .select(
      `id, zugangstoken,
       kunde:kunden(email, vorname),
       event:events!inner(titel, beginn, einlass, dresscode, status,
         ort:orte(name, strasse, plz, stadt))`,
    )
    .eq("status", "bezahlt")
    .is("erinnerung_am", null)
    .eq("event.status", "veroeffentlicht")
    .gt("event.beginn", jetzt.toISOString())
    .lte("event.beginn", grenze)
    .limit(500);

  if (error) {
    console.error("[erinnerung] Laden fehlgeschlagen:", error.message);
    return NextResponse.json({ fehler: error.message }, { status: 500 });
  }

  let gesendet = 0;
  let ohneAdresse = 0;
  for (const b of bestellungen ?? []) {
    const kunde = b.kunde as unknown as { email: string | null; vorname: string | null } | null;
    const event = b.event as unknown as {
      titel: string;
      beginn: string;
      einlass: string | null;
      dresscode: string | null;
      ort: { name: string; strasse: string | null; plz: string | null; stadt: string } | null;
    };
    if (!kunde?.email) {
      ohneAdresse++;
      continue;
    }

    const ok = await sendeErinnerung({
      an: kunde.email,
      vorname: kunde.vorname,
      eventTitel: event.titel,
      wann: berlinerZeit(event.beginn),
      einlass: event.einlass ? berlinerZeit(event.einlass) : null,
      ort: event.ort ? ortText(event.ort) : "",
      karte: event.ort ? karteAus(event.ort) : null,
      dresscode: event.dresscode,
      ticketLink: `${eigeneAdresse()}/tickets/${b.zugangstoken}`,
    });

    if (ok) {
      await db
        .from("bestellungen")
        .update({ erinnerung_am: new Date().toISOString() })
        .eq("id", b.id);
      gesendet++;
    }
  }

  return NextResponse.json({ gesendet, ohneAdresse });
}
