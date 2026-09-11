/**
 * Preise stehen in Cent in der Datenbank und werden erst hier zu Text.
 *
 * Glatte Beträge werden ohne Nachkommastellen gesetzt: "29 €", nicht
 * "29,00 €". Die zwei Nullen sind Kassenbon-Sprache und nehmen dem Preis
 * die Ruhe — bei krummen Beträgen stehen sie selbstverständlich da.
 */
export function preisText(cent: number, locale: string = "de"): string {
  const glatt = cent % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: glatt ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cent / 100);
}

/** Kurzes Datum für Karten und Listen: "29 SEP". */
export function datumKurz(iso: string, locale: string = "de"): string {
  const d = new Date(iso);
  const tag = new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(d);
  const monat = new Intl.DateTimeFormat(locale, { month: "short" })
    .format(d)
    .replace(".", "")
    .toUpperCase();
  return `${tag} ${monat}`;
}
