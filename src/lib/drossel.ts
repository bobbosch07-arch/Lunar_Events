import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { dienstClient } from "./supabase/server";
import { SUPABASE_GEHEIM } from "./supabase/umgebung";

/**
 * Grenzen für öffentliche Aktionen (0032). Jede Server-Aktion lässt sich
 * aus der Browser-Konsole mit beliebigen Werten und beliebig oft aufrufen;
 * was die Oberfläche begrenzt, gilt dort nicht.
 *
 * Die Grenzen stehen hier an einer Stelle. Sie sind großzügig, weil hinter
 * einer IP viele Menschen stecken können (Mobilfunk, WLAN am Club).
 */
export const GRENZEN = {
  /** Reservierte Tickets je Anschluss in 15 Minuten (so lange hält eine Reservierung). */
  reservierenTickets: { fenster: 15 * 60, grenze: 40 },
  /** Offene, unbezahlte Reservierungen je Mailadresse gleichzeitig. */
  offeneJeAdresse: 3,
  /** Codes prüfen (Rabatt, Presale) je Anschluss — gegen Durchprobieren. */
  codes: { fenster: 10 * 60, grenze: 30 },
  /** Zahlungen anlegen je Anschluss. */
  zahlung: { fenster: 10 * 60, grenze: 30 },
  /** Alles, was eine Mail an eine eingegebene Adresse schickt, je Anschluss … */
  mailAnschluss: { fenster: 60 * 60, grenze: 10 },
  /** … und je Zieladresse, damit niemand eine fremde Adresse zuschüttet. */
  mailAdresse: { fenster: 60 * 60, grenze: 3 },
  /** Passwort-Anmeldungen je Anschluss. */
  passwort: { fenster: 15 * 60, grenze: 10 },
} as const;

type Grenze = { fenster: number; grenze: number };

/** Höchstmengen einer Bestellung, dieselben wie in der Ticketauswahl. */
export const MAX_JE_PHASE = 20;
export const MAX_JE_BESTELLUNG = 20;
export const MAX_POSTEN = 10;

function kennung(wert: string): string {
  // HMAC statt einfachem Hash: Ohne das Geheimnis lässt sich aus der
  // gespeicherten Zeile keine IP zurückrechnen, auch nicht durch Ausprobieren
  // aller IPv4-Adressen.
  return createHmac("sha256", SUPABASE_GEHEIM ?? "lunar")
    .update(wert)
    .digest("hex")
    .slice(0, 32);
}

/** Die IP, wie Vercel sie setzt. Lokal gibt es keine, dann "lokal". */
async function anschluss(): Promise<string> {
  const h = await headers();
  const weitergeleitet = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return weitergeleitet || h.get("x-real-ip") || "lokal";
}

async function frage(schluessel: string, g: Grenze, gewicht: number): Promise<boolean> {
  const { data, error } = await dienstClient().rpc("drossel", {
    p_schluessel: schluessel,
    p_fenster_sek: g.fenster,
    p_grenze: g.grenze,
    p_gewicht: gewicht,
  });
  if (error) {
    // Lieber durchlassen als den Verkauf lahmlegen, wenn die Drossel selbst
    // klemmt. Das Protokoll zeigt es.
    console.error("[drossel] Abfrage fehlgeschlagen:", error.message);
    return true;
  }
  return data === true;
}

/** Zählt für den Anschluss (IP) des Aufrufers. */
export async function darfAnschluss(aktion: string, g: Grenze, gewicht = 1): Promise<boolean> {
  return frage(`${aktion}:ip:${kennung(await anschluss())}`, g, gewicht);
}

/** Zählt für eine Mailadresse. */
export async function darfAdresse(aktion: string, adresse: string, g: Grenze): Promise<boolean> {
  return frage(`${aktion}:mail:${kennung(adresse.trim().toLowerCase())}`, g, 1);
}

/** Für Aktionen, die eine Mail an eine eingegebene Adresse schicken. */
export async function darfMailSchicken(aktion: string, adresse: string): Promise<boolean> {
  return (
    (await darfAnschluss(aktion, GRENZEN.mailAnschluss)) &&
    (await darfAdresse(aktion, adresse, GRENZEN.mailAdresse))
  );
}

export const EMAIL_MUSTER = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
