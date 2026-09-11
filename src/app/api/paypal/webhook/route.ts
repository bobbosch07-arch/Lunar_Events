import { NextResponse } from "next/server";
import { dienstClient } from "@/lib/supabase/server";
import { verschickeTickets } from "@/app/aktionen/ticketmail";

export const dynamic = "force-dynamic";

/**
 * PayPals Meldungen. Absicherung, kein Hauptweg: Abgebucht wird von
 * unserem Server aus, und das Ergebnis kommt direkt zurück. Der Webhook
 * fängt den Fall ab, dass der Browser zwischen Zusage und Abbuchung
 * abbricht — oder dass jemand über PayPal erstattet.
 *
 * Die Echtheitsprüfung läuft über PayPals eigenen Prüf-Endpunkt: anders
 * als bei Stripe gibt es keine lokal nachrechenbare Signatur.
 */
async function istEcht(
  kopfzeilen: Headers,
  roh: string,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const id = process.env.PAYPAL_CLIENT_ID;
  const geheim = process.env.PAYPAL_CLIENT_SECRET;
  if (!webhookId || !id || !geheim) return false;

  const basis =
    process.env.PAYPAL_UMGEBUNG === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  const token = await fetch(`${basis}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${geheim}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })
    .then((a) => a.json() as Promise<{ access_token?: string }>)
    .catch(() => ({ access_token: undefined }));

  if (!token.access_token) return false;

  const pruefung = await fetch(`${basis}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: kopfzeilen.get("paypal-auth-algo"),
      cert_url: kopfzeilen.get("paypal-cert-url"),
      transmission_id: kopfzeilen.get("paypal-transmission-id"),
      transmission_sig: kopfzeilen.get("paypal-transmission-sig"),
      transmission_time: kopfzeilen.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(roh),
    }),
  })
    .then((a) => a.json() as Promise<{ verification_status?: string }>)
    .catch(() => ({ verification_status: undefined }));

  return pruefung.verification_status === "SUCCESS";
}

export async function POST(anfrage: Request) {
  const roh = await anfrage.text();

  if (!(await istEcht(anfrage.headers, roh))) {
    console.error("[paypal] Meldung nicht bestätigt — verworfen.");
    return NextResponse.json({ fehler: "nicht bestätigt" }, { status: 400 });
  }

  const ereignis = JSON.parse(roh) as {
    event_type?: string;
    resource?: {
      id?: string;
      custom_id?: string;
      supplementary_data?: { related_ids?: { order_id?: string } };
    };
  };

  const db = dienstClient();
  const bestellungId = ereignis.resource?.custom_id;

  switch (ereignis.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      if (!bestellungId) {
        console.error("[paypal] Buchung ohne custom_id:", ereignis.resource?.id);
        break;
      }
      // Mehrfach aufrufbar — PayPal wiederholt Meldungen.
      const { error } = await db.rpc("bestaetige_zahlung", {
        p_bestellung_id: bestellungId,
        p_zahlungsart: "paypal",
        p_referenz: ereignis.resource?.id ?? "paypal",
      });
      if (error) {
        console.error("[paypal] Bestätigung fehlgeschlagen:", error.message);
        return NextResponse.json({ fehler: error.message }, { status: 500 });
      }
      await verschickeTickets(bestellungId);
      break;
    }

    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      if (!bestellungId) break;
      await db
        .from("bestellungen")
        .update({ status: "erstattet" })
        .eq("id", bestellungId);
      // Erstattete Tickets dürfen am Einlass nicht mehr gelten.
      await db
        .from("tickets")
        .update({ status: "storniert" })
        .eq("bestellung_id", bestellungId)
        .eq("status", "gueltig");
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ empfangen: true });
}
