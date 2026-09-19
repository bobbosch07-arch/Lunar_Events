"use server";

import { cookies } from "next/headers";
import { dienstClient } from "@/lib/supabase/server";
import { stripe, eigeneAdresse } from "@/lib/stripe";
import { darfAnschluss, GRENZEN } from "@/lib/drossel";

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
  return zahlungVorbereiten(bestellungId);
}

/**
 * Dasselbe für die Abendkasse (0025): Der Gast scannt an der Tür einen
 * QR-Code und zahlt mit seinem eigenen Handy. Ein Cookie hat dieses Handy
 * nicht — der Nachweis ist der Zugangstoken im Link, und der gilt nur für
 * Bestellungen, die an der Kasse entstanden sind.
 */
export async function starteZahlungAnDerTuer(token: string): Promise<ZahlungErgebnis> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, fehler: "unbekannt" };
  const { data } = await dienstClient()
    .from("bestellungen")
    .select("id, abendkasse")
    .eq("zugangstoken", token)
    .maybeSingle();
  if (!data?.abendkasse) return { ok: false, fehler: "unbekannt" };
  return zahlungVorbereiten(data.id as string);
}

/**
 * Dasselbe für nachgebuchte Garderobe (0027). Nachweis ist der Ticketlink
 * der ursprünglichen Bestellung — die Nachbuchung muss zu ihr gehören. Ein
 * Cookie wie in der Kasse wäre hier falsch: Setzt eine Server-Aktion eines,
 * baut Next die Ticketseite neu auf, und war die letzte Marke gerade
 * reserviert, verschwand das Zahlformular mitsamt dem Blatt.
 */
export async function starteZahlungNachbuchung(
  token: string,
  bestellungId: string,
): Promise<ZahlungErgebnis> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, fehler: "unbekannt" };
  const db = dienstClient();
  const { data: ursprung } = await db
    .from("bestellungen")
    .select("id")
    .eq("zugangstoken", token)
    .maybeSingle();
  if (!ursprung) return { ok: false, fehler: "unbekannt" };
  const { data: nachbuchung } = await db
    .from("bestellungen")
    .select("id")
    .eq("id", bestellungId)
    .eq("nachbuchung_zu", ursprung.id as string)
    .maybeSingle();
  if (!nachbuchung) return { ok: false, fehler: "unbekannt" };
  return zahlungVorbereiten(bestellungId);
}

/** Der gemeinsame Teil: Betrag aus der Datenbank, ein Zahlungsvorgang je Bestellung. */
async function zahlungVorbereiten(bestellungId: string): Promise<ZahlungErgebnis> {
  // Jeder Aufruf fragt bei Stripe an; aus der Konsole ginge das endlos (0032).
  if (!(await darfAnschluss("zahlung", GRENZEN.zahlung))) return { ok: false, fehler: "zu_oft" };
  const db = dienstClient();
  const { data: bestellung, error } = await db
    .from("bestellungen")
    .select(
      "id, nummer, status, gesamt_cent, zahlung_ref, reserviert_bis, vorkasse, abendkasse, nachbuchung_zu, kunde:kunden(email)",
    )
    .eq("id", bestellungId)
    .single();

  if (error || !bestellung) return { ok: false, fehler: "unbekannt" };
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
      // An der Tür nur Karte (samt Apple Pay und Google Pay): Eine Lastschrift
      // gälte erst Tage später — der Gast wäre längst drin, wenn sie platzt.
      // Dasselbe für nachgebuchte Garderobe (0027): Die wird oft erst am
      // Abend selbst gebucht, und die Marke muss sofort gelten.
      ...(bestellung.abendkasse || bestellung.nachbuchung_zu
        ? { payment_method_types: ["card"] }
        : { automatic_payment_methods: { enabled: true } }),
      // An der Abendkasse gibt es oft keine Adresse — dann eben kein Beleg per Mail.
      receipt_email: kunde?.email ?? undefined,
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
