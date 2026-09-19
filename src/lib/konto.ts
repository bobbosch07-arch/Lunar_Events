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
  fastlane: boolean;
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
 * Die eigenen Tickets. Die Zugriffsregeln allein reichen dafür nicht: Admins
 * dürfen alle Tickets lesen (fürs Backoffice), hier sollen sie trotzdem nur
 * ihre eigenen sehen. Deshalb wird zusätzlich auf den eigenen Kunden
 * gefiltert (0031). `userId` kommt aus `holeAngemeldeten()`, also schon
 * beim Auth-Server nachgeprüft.
 */
export async function holeMeineTickets(
  userId: string,
  formatiere: (iso: string) => string,
): Promise<MeinTicket[]> {
  if (!datenbankVerbunden()) return [];

  const db = await serverClient();
  const { data: kunden } = await db
    .from("kunden")
    .select("id")
    .eq("user_id", userId);
  const kundenIds = (kunden ?? []).map((k) => k.id as string);
  if (kundenIds.length === 0) return [];

  const { data, error } = await db
    .from("tickets")
    .select(
      `code, phase_name, art, status, gast_name, platz, entwertet_am, fastlane,
       bestellung:bestellungen!inner(
         nummer, status,
         event:events(titel, beginn, ort:orte(name, stadt))
       )`,
    )
    .eq("bestellung.status", "bezahlt")
    .in("bestellung.kunde_id", kundenIds)
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
    fastlane: z.fastlane,
    event_titel: z.bestellung.event.titel,
    event_wann: formatiere(z.bestellung.event.beginn),
    event_ort: `${z.bestellung.event.ort.name}, ${z.bestellung.event.ort.stadt}`,
    bestellnummer: z.bestellung.nummer,
    beginn: z.bestellung.event.beginn,
    entwertet_am: z.entwertet_am,
  }));
}
