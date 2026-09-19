/**
 * Umsatzsteuer: Lunar Events ist Kleinunternehmer (§ 19 UStG, Stand
 * 19.09.2026). Es wird keine Umsatzsteuer berechnet, also auch keine
 * ausgewiesen. Der Hinweis muss trotzdem dastehen, wo ein Preis als Endpreis
 * genannt wird: Kasse, Bestätigung, AGB.
 *
 * Fällt die Regelung weg (Umsatzgrenze: 25.000 € im Vorjahr, 100.000 € im
 * laufenden Jahr), ändert sich das hier und in den AGB (Abschnitt 3). Dann
 * braucht es je Posten einen Satz und einen ausgewiesenen Betrag.
 */
export const STEUERHINWEIS = {
  de: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
  en: "No VAT is charged under the small business rule (§ 19 UStG).",
} as const;

export function steuerhinweis(locale: string): string {
  return locale === "en" ? STEUERHINWEIS.en : STEUERHINWEIS.de;
}
