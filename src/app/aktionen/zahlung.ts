"use server";

import { cookies } from "next/headers";
import { dienstClient } from "@/lib/supabase/server";
import { stripe, eigeneAdresse } from "@/lib/stripe";

const COOKIE = "lunar_bestellung";

export type ZahlungErgebnis =
  | { ok: true; clientSecret: string; betrag_cent: number }
  | { ok: false; fehler: string };

/**
 * Bereitet die Zahlung für eine bereits reservierte Bestellung vor.
 *
 * Der Betrag kommt **aus der Datenbank**, nie aus dem Browser. Wer den
 * Preis im Client manipuliert, ändert damit nichts an dem, was abgebucht
 * wird.
 */
export async function starteZahlung(
  bestellungId: string,
): Promise<ZahlungErgebnis> {
  const store = await cookies();
  if (store.get(COOKIE)?.value !== bestellungId) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { data: bestellung, error } = await db
    .from("bestellungen")
    .select("id, nummer, status, gesamt_cent, zahlung_ref, reserviert_bis, kunde:kunden(email)")
    .eq("id", bestellungId)
    .single();

  if (error || !bestellung) return { ok: false, fehler: "unbekannt" };
  if (bestellung.status === "bezahlt") return { ok: false, fehler: "schon_bezahlt" };
  if (bestellung.status !== "offen") return { ok: false, fehler: "nicht_offen" };
  if (
    bestellung.reserviert_bis &&
    new Date(bestellung.reserviert_bis as string) < new Date()
  ) {
    return { ok: false, fehler: "abgelaufen" };
  }

  const betrag = bestellung.gesamt_cent as number;
  const kunde = bestellung.kunde as unknown as { email: string } | null;

  const s = stripe();

  // Wird der Zahlungsschritt neu geladen, soll kein zweiter Vorgang
  // entstehen — sonst stehen zwei offene Zahlungen für eine Bestellung
  // in Stripe, und im Zweifel wird zweimal abgebucht.
  const vorhanden = bestellung.zahlung_ref as string | null;
  if (vorhanden?.startsWith("pi_")) {
    try {
      const alt = await s.paymentIntents.retrieve(vorhanden);
      if (
        alt.client_secret &&
        ["requires_payment_method", "requires_confirmation", "requires_action"].includes(
          alt.status,
        )
      ) {
        if (alt.amount !== betrag) {
          await s.paymentIntents.update(alt.id, { amount: betrag });
        }
        return { ok: true, clientSecret: alt.client_secret, betrag_cent: betrag };
      }
    } catch {
      // Nicht mehr auffindbar — dann eben ein neuer Vorgang.
    }
  }

  const absicht = await s.paymentIntents.create(
    {
      amount: betrag,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      receipt_email: kunde?.email,
      description: `Lunar Events · Bestellung ${bestellung.nummer}`,
      // Der Webhook erkennt die Bestellung hieran wieder.
      metadata: { bestellung_id: bestellungId, nummer: bestellung.nummer as string },
    },
    // Zwei schnelle Klicks sollen keinen zweiten Vorgang erzeugen.
    { idempotencyKey: `bestellung-${bestellungId}` },
  );

  await db
    .from("bestellungen")
    .update({ zahlung_ref: absicht.id, zahlungsart: "stripe" })
    .eq("id", bestellungId);

  return {
    ok: true,
    clientSecret: absicht.client_secret!,
    betrag_cent: betrag,
  };
}

/** Adresse, zu der Stripe nach der Zahlung zurückschickt. */
export async function rueckkehrAdresse(bestellungId: string): Promise<string> {
  return `${eigeneAdresse()}/checkout/bestaetigung?b=${bestellungId}`;
}
