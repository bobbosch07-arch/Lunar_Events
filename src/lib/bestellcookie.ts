import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SUPABASE_GEHEIM } from "./supabase/umgebung";

/**
 * Der Nachweis, dass eine Bestellung diesem Browser gehört (Gastkäufe haben
 * kein Konto). Früher stand im Cookie die Bestell-ID selbst, und geprüft
 * wurde `cookie === id`. Weil die ID auch in der Bestätigungsadresse steht
 * (`?b=…`), konnte jeder, der sie kannte, das Cookie nachbauen und an eine
 * fremde Bestellung samt Ticketlink kommen (Audit 19.09.2026).
 *
 * Jetzt steht im Cookie eine Signatur der ID mit unserem Serverschlüssel.
 * Ohne den Schlüssel lässt sie sich nicht erzeugen; die ID allein genügt
 * nicht mehr. `httpOnly`, damit kein Skript im Browser sie ausliest.
 */
const COOKIE = "lunar_bestellung";
const DAUER = 60 * 60 * 4;

function signatur(bestellungId: string): string {
  return createHmac("sha256", SUPABASE_GEHEIM ?? "lunar")
    .update(`bestellung:${bestellungId}`)
    .digest("hex");
}

export async function setzeBestellCookie(bestellungId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, signatur(bestellungId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DAUER,
    path: "/",
  });
}

export async function bestellCookieGilt(bestellungId: string): Promise<boolean> {
  const store = await cookies();
  const wert = store.get(COOKIE)?.value;
  if (!wert) return false;
  const soll = signatur(bestellungId);
  // Konstante Zeit, sonst verriete die Vergleichsdauer die Signatur Zeichen
  // für Zeichen. Beide Seiten sind Hex gleicher Länge.
  const a = Buffer.from(wert);
  const b = Buffer.from(soll);
  return a.length === b.length && timingSafeEqual(a, b);
}
