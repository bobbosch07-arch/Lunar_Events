import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { dienstClient } from "@/lib/supabase/server";
import { verschickeTickets } from "@/app/aktionen/ticketmail";

export const dynamic = "force-dynamic";

/**
 * Stripe meldet hier, was mit einer Zahlung passiert ist.
 *
 * Das ist die **einzige** Stelle, der wir glauben. Der Browser kann
 * behaupten, was er will — er kann manipuliert werden, er kann abstürzen,
 * der Gast kann den Tab schließen, bevor er zurückgeleitet wird. Der
 * Webhook kommt trotzdem.
 *
 * Die Signatur wird gegen den rohen Text geprüft, nicht gegen geparstes
 * JSON: schon ein umsortiertes Feld würde die Prüfung scheitern lassen.
 */
export async function POST(anfrage: Request) {
  const geheimnis = process.env.STRIPE_WEBHOOK_SECRET;
  if (!geheimnis) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET fehlt — Meldung verworfen.");
    return NextResponse.json({ fehler: "nicht eingerichtet" }, { status: 500 });
  }

  const signatur = anfrage.headers.get("stripe-signature");
  if (!signatur) {
    return NextResponse.json({ fehler: "keine Signatur" }, { status: 400 });
  }

  const roh = await anfrage.text();

  let ereignis: Stripe.Event;
  try {
    ereignis = stripe().webhooks.constructEvent(roh, signatur, geheimnis);
  } catch (fehler) {
    // Wer die Signatur nicht hat, ist nicht Stripe.
    console.error("[stripe] Signatur ungültig:", (fehler as Error).message);
    return NextResponse.json({ fehler: "Signatur ungültig" }, { status: 400 });
  }

  const db = dienstClient();

  switch (ereignis.type) {
    case "payment_intent.succeeded": {
      const absicht = ereignis.data.object;
      const bestellungId = absicht.metadata?.bestellung_id;
      if (!bestellungId) {
        console.error("[stripe] Zahlung ohne bestellung_id:", absicht.id);
        break;
      }

      // Mehrfach aufrufbar: Stripe wiederholt Meldungen, bis wir 200
      // antworten, und meldet denselben Vorgang gern zweimal.
      const { error } = await db.rpc("bestaetige_zahlung", {
        p_bestellung_id: bestellungId,
        p_zahlungsart: "stripe",
        p_referenz: absicht.id,
        // Was Stripe wirklich eingezogen hat, gegen den Bestellbetrag (0033).
        p_erwartet_cent: absicht.amount_received ?? absicht.amount,
      });

      if (error) {
        console.error("[stripe] Bestätigung fehlgeschlagen:", error.message);
        // 500 heißt für Stripe: nochmal versuchen. Das ist hier richtig,
        // denn die Zahlung ist echt und die Tickets fehlen noch.
        return NextResponse.json({ fehler: error.message }, { status: 500 });
      }

      // Der Versand darf die Quittung an Stripe nicht aufhalten: die
      // Tickets existieren, auch wenn keine Mail rausgeht.
      await verschickeTickets(bestellungId);
      break;
    }

    case "payment_intent.payment_failed": {
      const absicht = ereignis.data.object;
      const bestellungId = absicht.metadata?.bestellung_id;
      // Die Reservierung bleibt bestehen: der Gast darf es nochmal
      // versuchen, solange seine Frist läuft. Abgelaufene Reservierungen
      // räumt raeume_reservierungen_auf() weg.
      console.warn(
        "[stripe] Zahlung gescheitert:",
        bestellungId,
        absicht.last_payment_error?.message,
      );
      break;
    }

    case "charge.refunded": {
      const beleg = ereignis.data.object;
      const absichtId =
        typeof beleg.payment_intent === "string" ? beleg.payment_intent : null;
      if (absichtId) {
        await db
          .from("bestellungen")
          .update({ status: "erstattet" })
          .eq("zahlung_ref", absichtId);
        // Erstattete Tickets dürfen am Einlass nicht mehr gelten.
        const { data: bestellung } = await db
          .from("bestellungen")
          .select("id")
          .eq("zahlung_ref", absichtId)
          .maybeSingle();
        if (bestellung) {
          await db
            .from("tickets")
            .update({ status: "storniert" })
            .eq("bestellung_id", bestellung.id)
            .eq("status", "gueltig");
          // Garderobenmarken (0027) genauso, aber nur noch nicht abgegebene:
          // Eine Jacke, die schon hängt, muss abholbar bleiben.
          await db
            .from("garderobe_marken")
            .update({ status: "storniert" })
            .eq("bestellung_id", bestellung.id)
            .eq("status", "gueltig")
            .is("abgegeben_am", null);
        }
      }
      break;
    }

    default:
      // Alles andere quittieren wir, ohne etwas zu tun — sonst wiederholt
      // Stripe es endlos.
      break;
  }

  return NextResponse.json({ empfangen: true });
}
