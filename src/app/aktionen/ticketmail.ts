"use server";

import { dienstClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeTickets } from "@/lib/mail";

/**
 * Verschickt die Tickets — genau einmal je Bestellung.
 *
 * Wird von allen Stellen gerufen, die eine Zahlung bestätigen: dem
 * Stripe-Webhook, dem PayPal-Abschluss, der Bestätigungsseite und dem
 * Testkauf. Der Vermerk `mail_gesendet_am` verhindert, dass daraus zwei
 * oder drei Mails werden.
 *
 * Scheitert der Versand, bleibt der Vermerk leer und der nächste Anlauf
 * versucht es erneut — aber der Kauf gilt trotzdem. Tickets existieren
 * unabhängig davon, ob eine Mail ankommt.
 */
export async function verschickeTickets(bestellungId: string): Promise<void> {
  const db = dienstClient();

  const { data: bestellung } = await db
    .from("bestellungen")
    .select(
      `id, nummer, status, zugangstoken, mail_gesendet_am,
       kunde:kunden(email, vorname),
       event:events(titel, beginn, ort:orte(name, stadt)),
       tickets(id)`,
    )
    .eq("id", bestellungId)
    .single();

  if (!bestellung) return;
  if (bestellung.status !== "bezahlt") return;
  if (bestellung.mail_gesendet_am) return;

  const kunde = bestellung.kunde as unknown as {
    email: string;
    vorname: string | null;
  } | null;
  const event = bestellung.event as unknown as {
    titel: string;
    beginn: string;
    ort: { name: string; stadt: string };
  } | null;

  if (!kunde?.email || !event) return;

  const wann = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(event.beginn));

  const geschickt = await sendeTickets({
    an: kunde.email,
    vorname: kunde.vorname,
    bestellnummer: bestellung.nummer as string,
    eventTitel: event.titel,
    wann: `${wann} Uhr`,
    ort: `${event.ort.name}, ${event.ort.stadt}`,
    anzahl: ((bestellung.tickets ?? []) as unknown[]).length,
    ticketLink: `${eigeneAdresse()}/tickets/${bestellung.zugangstoken}`,
  });

  if (geschickt) {
    await db
      .from("bestellungen")
      .update({ mail_gesendet_am: new Date().toISOString() })
      .eq("id", bestellungId);
  }
}
