/**
 * Vorkasse per Überweisung.
 *
 * Die Bankverbindung steht nicht im Code, sondern in der Hosting-Umgebung.
 * Fehlt sie, gibt es Vorkasse nicht — wie bei Stripe und PayPal: kein
 * Zwischenzustand, in dem ein Gast bestellt und keine IBAN sieht.
 *
 * Nur auf dem Server benutzen: Die Werte kommen aus process.env und
 * sollen nicht über ein Client-Bundle wandern, bevor jemand bestellt hat.
 */

/** So lange bleiben die Plätze reserviert (höchstens bis 2 Tage vor Beginn). */
export const VORKASSE_FRIST_TAGE = 3;

/** Mindestabstand zum Event, damit Überweisung und Kontrolle rechtzeitig gehen. */
export const VORKASSE_MINDEST_TAGE = 5;

export function vorkasseEingerichtet(): boolean {
  return Boolean(process.env.VORKASSE_KONTOINHABER && process.env.VORKASSE_IBAN);
}

/** Wird für dieses Event Vorkasse angeboten? */
export function vorkasseMoeglich(beginn: string): boolean {
  if (!vorkasseEingerichtet()) return false;
  return new Date(beginn).getTime() - Date.now() > VORKASSE_MINDEST_TAGE * 86400000;
}

export type Bankdaten = {
  inhaber: string;
  /** In Viererblöcken, so wie man sie abtippt. */
  iban: string;
  bic: string | null;
  bank: string | null;
};

export function bankdaten(): Bankdaten | null {
  if (!vorkasseEingerichtet()) return null;
  const roh = process.env.VORKASSE_IBAN!.replace(/\s+/g, "").toUpperCase();
  return {
    inhaber: process.env.VORKASSE_KONTOINHABER!.trim(),
    iban: roh.replace(/(.{4})/g, "$1 ").trim(),
    bic: process.env.VORKASSE_BIC?.trim() || null,
    bank: process.env.VORKASSE_BANK?.trim() || null,
  };
}
