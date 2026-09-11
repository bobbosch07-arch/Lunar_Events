import { serverClient, datenbankVerbunden } from "./supabase/server";
import type { TicketAnzeige } from "@/components/TicketKarte";

export type Angemeldet = { id: string; email: string } | null;

export async function holeAngemeldeten(): Promise<Angemeldet> {
  if (!datenbankVerbunden()) return null;
  const db = await serverClient();
  // getUser() statt getSession(): nur das prüft den Token beim Server nach.
  // getSession() glaubt dem Cookie, und dem darf man nicht glauben.
  const { data } = await db.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

type TicketZeile = {
  code: string;
  phase_name: string;
  art: string;
  status: string;
  gast_name: string | null;
  platz: string | null;
  entwertet_am: string | null;
  bestellung: {
    nummer: string;
    event: { titel: string; beginn: string; ort: { name: string; stadt: string } };
  };
};

export type MeinTicket = TicketAnzeige & {
  beginn: string;
  entwertet_am: string | null;
};

/**
 * Die eigenen Tickets. Welche das sind, entscheiden die Zugriffsregeln in
 * der Datenbank — hier wird nichts zusätzlich gefiltert, damit es keine
 * zweite Wahrheit gibt.
 */
export async function holeMeineTickets(
  formatiere: (iso: string) => string,
): Promise<MeinTicket[]> {
  if (!datenbankVerbunden()) return [];

  const db = await serverClient();
  const { data, error } = await db
    .from("tickets")
    .select(
      `code, phase_name, art, status, gast_name, platz, entwertet_am,
       bestellung:bestellungen!inner(
         nummer, status,
         event:events(titel, beginn, ort:orte(name, stadt))
       )`,
    )
    .eq("bestellung.status", "bezahlt")
    .order("erstellt_am", { ascending: false });

  if (error) {
    console.error("[konto] Tickets laden fehlgeschlagen:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as TicketZeile[]).map((z) => ({
    code: z.code,
    phase_name: z.phase_name,
    art: z.art === "vip" ? "vip" : "standard",
    status:
      z.status === "entwertet"
        ? "entwertet"
        : z.status === "storniert"
          ? "storniert"
          : "gueltig",
    gast_name: z.gast_name,
    platz: z.platz,
    event_titel: z.bestellung.event.titel,
    event_wann: formatiere(z.bestellung.event.beginn),
    event_ort: `${z.bestellung.event.ort.name}, ${z.bestellung.event.ort.stadt}`,
    bestellnummer: z.bestellung.nummer,
    beginn: z.bestellung.event.beginn,
    entwertet_am: z.entwertet_am,
  }));
}
