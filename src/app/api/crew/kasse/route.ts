import { NextResponse, type NextRequest } from "next/server";
import {
  brecheTuerVerkaufAb,
  holeKassenstand,
  pruefeTuerZahlung,
  verkaufeAnDerTuer,
} from "@/app/aktionen/kasse";
import { serverClient } from "@/lib/supabase/server";
import { stripeEingerichtet } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Die Abendkasse der Crew-App. Eine Route statt Server-Aktionen: Die
 * Crew-App liegt im Speicher des Geräts, und die Kennungen von
 * Server-Aktionen ändern sich mit jedem Deploy — eine zwischengespeicherte
 * Seite riefe dann ins Leere. Diese Adresse bleibt stehen.
 *
 * Die Arbeit machen dieselben Funktionen wie an /kasse; die Datenbank prüft
 * die Rolle bei jedem Verkauf selbst (`ist_mitarbeiter('kasse')`).
 */

const KEIN_SPEICHER = { "Cache-Control": "no-store" };

function antwort(daten: unknown, status = 200) {
  return NextResponse.json(daten, { status, headers: KEIN_SPEICHER });
}

async function darfKassieren(): Promise<boolean> {
  const { data } = await (await serverClient()).rpc("ist_mitarbeiter", { mindestens: "kasse" });
  return data === true;
}

/** Phasen mit Rest, Kassenstand und ob QR-Zahlung geht. */
export async function GET(anfrage: NextRequest) {
  const eventId = anfrage.nextUrl.searchParams.get("event");
  if (!eventId) return antwort({ ergebnis: "event_fehlt" }, 400);
  if (!(await darfKassieren())) return antwort({ ergebnis: "keine_berechtigung" }, 403);

  const db = await serverClient();
  const [{ data: phasen }, stand] = await Promise.all([
    db
      .from("phasen")
      .select("id, name, preis_cent, gebuehr_cent, kontingent, verkauft, position")
      .eq("event_id", eventId)
      .eq("abendkasse", true)
      .eq("aktiv", true)
      .order("position"),
    holeKassenstand(eventId),
  ]);

  return antwort({
    ergebnis: "ok",
    qrMoeglich: stripeEingerichtet(),
    stand,
    phasen: (phasen ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      preis_cent: p.preis_cent as number,
      gebuehr_cent: p.gebuehr_cent as number,
      rest:
        p.kontingent === null ? null : Math.max((p.kontingent as number) - (p.verkauft as number), 0),
    })),
  });
}

type Schritt =
  | { schritt: "verkaufen"; eventId: string; phaseId: string; menge: number; zahlung: "bar" | "qr"; einlassen: boolean }
  | { schritt: "zahlung"; bestellungId: string; einlassen: boolean }
  | { schritt: "abbrechen"; bestellungId: string };

export async function POST(anfrage: NextRequest) {
  const eingabe = (await anfrage.json().catch(() => null)) as Schritt | null;
  if (!eingabe) return antwort({ ergebnis: "eingabe" }, 400);

  if (eingabe.schritt === "verkaufen") {
    return antwort(
      await verkaufeAnDerTuer({
        eventId: String(eingabe.eventId),
        phaseId: String(eingabe.phaseId),
        menge: Number(eingabe.menge),
        zahlung: eingabe.zahlung === "qr" ? "qr" : "bar",
        einlassen: Boolean(eingabe.einlassen),
      }),
    );
  }
  if (eingabe.schritt === "zahlung") {
    return antwort(await pruefeTuerZahlung(String(eingabe.bestellungId), Boolean(eingabe.einlassen)));
  }
  if (eingabe.schritt === "abbrechen") {
    return antwort(await brecheTuerVerkaufAb(String(eingabe.bestellungId)));
  }
  return antwort({ ergebnis: "eingabe" }, 400);
}
