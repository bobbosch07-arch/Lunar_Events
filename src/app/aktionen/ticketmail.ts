"use server";

import { dienstClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeTickets } from "@/lib/mail";
import { appleEingerichtet, erzeugeApplePass } from "@/lib/wallet/apple";
import { ladePassDaten } from "@/lib/wallet/laden";

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
      `id, nummer, status, zugangstoken, mail_gesendet_am, nachbuchung_zu,
       kunde:kunden(email, vorname),
       event:events(titel, beginn, ort:orte(name, stadt)),
       tickets(id, code),
       garderobe_marken(id)`,
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

  const tickets = (bestellung.tickets ?? []) as Array<{ code: string }>;
  const marken = ((bestellung.garderobe_marken ?? []) as Array<{ id: string }>).length;

  // Nachgebuchte Garderobe (0027) hat keine eigene Ticketseite: Die Marken
  // stehen unter den Tickets der ursprünglichen Bestellung.
  let seitenToken = bestellung.zugangstoken as string;
  if (bestellung.nachbuchung_zu) {
    const { data: ursprung } = await db
      .from("bestellungen")
      .select("zugangstoken")
      .eq("id", bestellung.nachbuchung_zu as string)
      .single();
    if (ursprung?.zugangstoken) seitenToken = ursprung.zugangstoken as string;
  }

  // Apple-Pässe hängen direkt an: Ein Tipp im Anhang, und das Ticket
  // liegt in Wallet — das ist der ganze Sinn der Sache. Google geht nur
  // über den Link auf der Ticketseite.
  //
  // Ab sieben Tickets bleibt es beim Link: Jeder Pass wiegt rund 100 KB,
  // und eine Mail, die am Postfach abprallt, ist schlimmer als eine ohne
  // Anhang.
  let paesse: Array<{ name: string; inhaltBase64: string }> | undefined;
  if (appleEingerichtet() && tickets.length <= 6) {
    const erzeugte: Array<{ name: string; inhaltBase64: string }> = [];
    for (const ticket of tickets) {
      try {
        const geladen = await ladePassDaten(
          ticket.code,
          bestellung.zugangstoken as string,
        );
        if (!geladen) continue;
        const roh = await erzeugeApplePass(geladen.daten);
        erzeugte.push({
          name: `lunar-${ticket.code}.pkpass`,
          inhaltBase64: roh.toString("base64"),
        });
      } catch (fehler) {
        // Ein fehlgeschlagener Pass darf die Mail nicht aufhalten — die
        // Tickets stehen ohnehin hinter dem Link.
        console.error("[mail] Pass nicht erzeugt:", (fehler as Error).message);
      }
    }
    if (erzeugte.length > 0) paesse = erzeugte;
  }

  const geschickt = await sendeTickets({
    an: kunde.email,
    vorname: kunde.vorname,
    bestellnummer: bestellung.nummer as string,
    eventTitel: event.titel,
    wann: `${wann} Uhr`,
    ort: `${event.ort.name}, ${event.ort.stadt}`,
    anzahl: tickets.length,
    ticketLink: `${eigeneAdresse()}/tickets/${seitenToken}`,
    paesse,
    garderobe: marken,
  });

  if (geschickt) {
    await db
      .from("bestellungen")
      .update({ mail_gesendet_am: new Date().toISOString() })
      .eq("id", bestellungId);
  }
}
