"use server";

import { cookies } from "next/headers";
import { dienstClient } from "@/lib/supabase/server";
import { erstelleBestellung, bucheAb, leseBestellung } from "@/lib/paypal";
import { verschickeTickets } from "./ticketmail";

const COOKIE = "lunar_bestellung";

async function gehoertMir(bestellungId: string): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE)?.value === bestellungId;
}

/**
 * Legt bei PayPal eine Bestellung an und gibt deren Kennung zurück.
 *
 * Der Betrag kommt aus unserer Datenbank, nicht aus dem Browser — wie
 * bei Stripe. Wer im Client den Preis ändert, ändert nichts an dem, was
 * PayPal abbucht.
 */
export async function paypalBestellungAnlegen(
  bestellungId: string,
): Promise<{ ok: true; id: string } | { ok: false; fehler: string }> {
  if (!(await gehoertMir(bestellungId))) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select("nummer, status, gesamt_cent, reserviert_bis, vorkasse, event:events(titel)")
    .eq("id", bestellungId)
    .single();

  if (!bestellung) return { ok: false, fehler: "unbekannt" };
  if (bestellung.status === "bezahlt") return { ok: false, fehler: "schon_bezahlt" };
  if (bestellung.status !== "offen") return { ok: false, fehler: "nicht_offen" };
  // Vorkasse-Bestellungen tragen den Rabatt schon im Betrag. Über Karte
  // oder PayPal abzubuchen hieße, den Nachlass ohne Überweisung zu geben.
  if (bestellung.vorkasse) return { ok: false, fehler: "vorkasse" };
  if (
    bestellung.reserviert_bis &&
    new Date(bestellung.reserviert_bis as string) < new Date()
  ) {
    return { ok: false, fehler: "abgelaufen" };
  }

  const event = bestellung.event as unknown as { titel: string } | null;

  try {
    const angelegt = await erstelleBestellung({
      betragCent: bestellung.gesamt_cent as number,
      bestellnummer: bestellung.nummer as string,
      bestellungId,
      beschreibung: `Lunar Events · ${event?.titel ?? "Tickets"}`,
    });

    await db
      .from("bestellungen")
      .update({ zahlung_ref: angelegt.id, zahlungsart: "paypal" })
      .eq("id", bestellungId);

    return { ok: true, id: angelegt.id };
  } catch (fehler) {
    console.error("[paypal] Anlegen fehlgeschlagen:", (fehler as Error).message);
    return { ok: false, fehler: "anbieter" };
  }
}

/**
 * Bucht ab und stellt die Tickets aus.
 *
 * Anders als bei Stripe gibt es hier keinen zwingenden Umweg über einen
 * Webhook: Der Abbuchungsaufruf kommt von unserem Server und liefert das
 * Ergebnis direkt. Der Webhook bleibt trotzdem die Absicherung für den
 * Fall, dass der Browser zwischen Zusage und Abbuchung abbricht.
 */
export async function paypalAbschliessen(
  bestellungId: string,
  paypalId: string,
): Promise<{ ok: true; nummer: string } | { ok: false; fehler: string }> {
  if (!(await gehoertMir(bestellungId))) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();

  try {
    let buchung = await bucheAb(paypalId);

    // "ORDER_ALREADY_CAPTURED" wirft einen Fehler; deshalb hier noch
    // einmal nachsehen, falls der Status nicht eindeutig ist.
    if (buchung.status !== "COMPLETED") {
      buchung = await leseBestellung(paypalId);
    }

    if (buchung.status !== "COMPLETED") {
      return { ok: false, fehler: `nicht_abgeschlossen:${buchung.status}` };
    }

    const belegId =
      buchung.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? paypalId;

    const { error } = await db.rpc("bestaetige_zahlung", {
      p_bestellung_id: bestellungId,
      p_zahlungsart: "paypal",
      p_referenz: belegId,
    });

    if (error) {
      // Das Geld ist da, die Tickets fehlen — das darf nicht stillschweigend
      // passieren.
      console.error(
        `[paypal] ABGEBUCHT, ABER NICHT BESTÄTIGT. Bestellung ${bestellungId}, ` +
          `PayPal ${belegId}: ${error.message}`,
      );
      return { ok: false, fehler: "bestaetigung" };
    }

    await verschickeTickets(bestellungId);

    const { data } = await db
      .from("bestellungen")
      .select("nummer")
      .eq("id", bestellungId)
      .single();

    return { ok: true, nummer: (data?.nummer as string) ?? "" };
  } catch (fehler) {
    console.error("[paypal] Abbuchen fehlgeschlagen:", (fehler as Error).message);
    return { ok: false, fehler: "anbieter" };
  }
}
