/**
 * Wer gehört zum Personal, und was darf diese Rolle?
 *
 * Rollen sind **Aufgaben**, keine Rechtestufen (Fragebogen 16.09.2026):
 * Man trägt jemanden als „Bar" ein, weil er an der Bar steht — was er in
 * der Software darf, folgt daraus. Die alte Bürorolle „team" ist weg; ins
 * Backoffice kommen nur Admins (entschieden 17.09.2026).
 *
 * Dieselben Regeln stehen in `ist_mitarbeiter()` (Migration 0022). Ändert
 * sich hier etwas, muss es dort mit — die Datenbank entscheidet, diese
 * Datei sorgt nur dafür, dass die Oberfläche dasselbe sagt.
 */

export const ROLLEN = [
  "admin",
  "kasse",
  "einlass",
  "bar",
  "security",
  "runner",
  "toiletten",
] as const;

export type Rolle = (typeof ROLLEN)[number];

export const ROLLEN_NAMEN: Record<Rolle, string> = {
  admin: "Admin",
  kasse: "Kasse",
  einlass: "Einlass",
  bar: "Bar",
  security: "Security",
  runner: "Runner",
  toiletten: "Toiletten",
};

/** Nur Admins sehen Zahlen, Bestellungen und Kundendaten. */
export function darfBackoffice(rolle: Rolle): boolean {
  return rolle === "admin";
}

/** Einlass, Bar und Kasse scannen — Security, Runner und Toiletten nicht. */
export function darfScannen(rolle: Rolle): boolean {
  return rolle === "admin" || rolle === "kasse" || rolle === "einlass" || rolle === "bar";
}

/** Geld und Kundendaten nur mit zweitem Faktor (Fragebogen 16.09.2026). */
export function brauchtZweiFaktor(rolle: Rolle): boolean {
  return rolle === "admin" || rolle === "kasse";
}

/**
 * Wie lange eine Anmeldung gilt — gemessen ab der echten Anmeldung, nicht
 * ab der letzten Aktivität. Wer an Geld kommt, kürzer.
 */
export function sitzungStunden(rolle: Rolle): number {
  return brauchtZweiFaktor(rolle) ? 8 : 24;
}

export function istRolle(wert: unknown): wert is Rolle {
  return typeof wert === "string" && (ROLLEN as readonly string[]).includes(wert);
}
