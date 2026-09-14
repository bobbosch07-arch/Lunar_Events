import { dienstClient } from "../supabase/server";
import { eigeneAdresse } from "../stripe";
import type { PassDaten } from "./typen";

/**
 * Lädt alles, was ein Pass über ein Ticket wissen muss — für beide
 * Anbieter dieselbe Abfrage.
 *
 * Der Zugang läuft über den Ticketcode zusammen mit dem Zugangstoken der
 * Bestellung. Der Code allein genügt nicht: Er steht im QR und wird am
 * Einlass herumgezeigt; wer ihn abfotografiert, soll sich daraus keinen
 * Pass bauen können.
 */
export async function ladePassDaten(
  code: string,
  zugangstoken: string,
): Promise<{ daten: PassDaten; eventId: string } | null> {
  const db = dienstClient();

  const { data: ticket } = await db
    .from("tickets")
    .select(
      `code, phase_name, art, status, gast_name, platz, fastlane,
       bestellung:bestellungen!inner(nummer, status, zugangstoken),
       event:events(id, titel, beginn, einlass, status,
                    ort:orte(name, stadt, strasse, lat, lng))`,
    )
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  if (!ticket) return null;

  const bestellung = ticket.bestellung as unknown as {
    nummer: string;
    status: string;
    zugangstoken: string;
  };
  const event = ticket.event as unknown as {
    id: string;
    titel: string;
    beginn: string;
    einlass: string | null;
    status: string;
    ort: {
      name: string;
      stadt: string;
      strasse: string | null;
      lat: number | null;
      lng: number | null;
    };
  };

  if (bestellung.zugangstoken !== zugangstoken) return null;
  if (bestellung.status !== "bezahlt") return null;
  if (ticket.status === "storniert") return null;

  return {
    eventId: event.id,
    daten: {
      code: ticket.code as string,
      eventTitel: event.titel,
      beginn: event.beginn,
      einlass: event.einlass,
      ortName: event.ort.name,
      ortStadt: event.ort.stadt,
      ortStrasse: event.ort.strasse,
      lat: event.ort.lat,
      lng: event.ort.lng,
      // Fast Lane steht mit im Tickettyp — am Einlass zeigt der Gast den
      // Pass, nicht die Webseite.
      ticketArt: ticket.fastlane
        ? `${ticket.phase_name as string} · Fast Lane`
        : (ticket.phase_name as string),
      gastName: (ticket.gast_name as string | null) ?? null,
      platz: (ticket.platz as string | null) ?? null,
      bestellnummer: bestellung.nummer,
      ticketLink: `${eigeneAdresse()}/tickets/${zugangstoken}`,
      vip: ticket.art === "vip",
    },
  };
}
