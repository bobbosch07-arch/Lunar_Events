import { bankdaten } from "./vorkasse";

/**
 * Direkt zahlen an der Abendkasse (0052): paypal.me-Link und Überweisung per
 * GiroCode — ohne Stripe, ohne PayPal-Schnittstelle, ohne Gebühr des
 * Zahlungsdienstes. Der Gast zahlt selbst, die Crew bestätigt.
 *
 * Nur auf dem Server benutzen: Die Werte kommen aus process.env.
 *
 * - `KASSE_PAYPAL_ME`: der paypal.me-Name (ohne Adresse davor), z. B.
 *   `lunarevents`. Ohne ihn gibt es an der Kasse keinen PayPal-Knopf.
 * - `KASSE_KONTOINHABER`, `KASSE_IBAN`, optional `KASSE_BIC`: das Konto für
 *   Überweisungen. Fehlen sie, gilt das Vorkasse-Konto (`VORKASSE_*`).
 *   Eigene Werte, weil `VORKASSE_IBAN` online die Vorkasse einschaltet —
 *   die Abendkasse soll das nicht nebenbei tun.
 */

export function paypalMeName(): string | null {
  const roh = process.env.KASSE_PAYPAL_ME?.trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, "").replace(/\/.*$/, "");
  return roh && /^[A-Za-z0-9]{1,40}$/.test(roh) ? roh : null;
}

type Konto = { inhaber: string; iban: string; bic: string | null };

export function kassenKonto(): Konto | null {
  const iban = process.env.KASSE_IBAN?.replace(/\s+/g, "").toUpperCase();
  const inhaber = process.env.KASSE_KONTOINHABER?.trim();
  if (iban && inhaber) return { inhaber, iban, bic: process.env.KASSE_BIC?.trim() || null };
  const vorkasse = bankdaten();
  return vorkasse ? { inhaber: vorkasse.inhaber, iban: vorkasse.iban.replace(/\s+/g, ""), bic: vorkasse.bic } : null;
}

/** Betrag für paypal.me und GiroCode: „12.50“, Punkt als Trenner. */
function euro(cent: number): string {
  return (cent / 100).toFixed(2);
}

/** paypal.me mit Betrag. Welche Art von Zahlung, wählt der Gast in PayPal. */
export function paypalMeLink(cent: number): string | null {
  const name = paypalMeName();
  return name ? `https://paypal.me/${name}/${euro(cent)}EUR` : null;
}

/**
 * GiroCode (EPC-QR, Version 002): Banking-Apps lesen daraus Empfänger,
 * IBAN, Betrag und Verwendungszweck — der Gast muss nichts abtippen und
 * wählt nur noch die Echtzeitüberweisung. Felder in fester Reihenfolge,
 * je eine Zeile; der BIC darf ab Version 002 im EWR leer bleiben.
 */
export function girocode(cent: number, verwendungszweck: string): string | null {
  const konto = kassenKonto();
  if (!konto) return null;
  return [
    "BCD",
    "002",
    "1", // UTF-8
    "SCT",
    konto.bic ?? "",
    konto.inhaber.slice(0, 70),
    konto.iban,
    `EUR${euro(cent)}`,
    "", // Zweck-Code
    "", // strukturierte Referenz
    verwendungszweck.slice(0, 140),
  ].join("\n");
}

/** IBAN in Viererblöcken, zum Ablesen, falls die Banking-App keinen QR kann. */
export function ibanLesbar(iban: string): string {
  return iban.replace(/(.{4})/g, "$1 ").trim();
}
