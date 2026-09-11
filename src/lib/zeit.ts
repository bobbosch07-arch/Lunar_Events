/**
 * Zeiten aus Formularfeldern und aus der Datenbank.
 *
 * Ein datetime-local-Feld liefert keine Zeitzone. Gemeint ist immer
 * Ortszeit in Berlin — ein Event beginnt um 23 Uhr, nicht um 21 Uhr UTC.
 * Ohne diese Umrechnung wandern alle Termine um ein bis zwei Stunden,
 * je nach Jahreszeit.
 *
 * Steht bewusst hier und nicht bei den Serveraktionen: eine Datei mit
 * "use server" darf nur asynchrone Funktionen ausfuehren.
 */
export function berlinNachUtc(ortszeit: string): string {
  // Erst so tun, als wäre die Eingabe UTC …
  const alsWaereUtc = new Date(`${ortszeit}:00Z`);

  // … dann nachsehen, was eine Berliner Uhr zu diesem Zeitpunkt zeigt.
  // Die Differenz ist der Versatz, der zu diesem Datum gilt — im Sommer
  // zwei Stunden, im Winter eine. Ein fest eingetragener Wert wäre in
  // der halben Saison falsch.
  const berlinerAnzeige = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(alsWaereUtc);

  const versatz =
    new Date(`${berlinerAnzeige.replace(" ", "T")}Z`).getTime() -
    alsWaereUtc.getTime();

  return new Date(alsWaereUtc.getTime() - versatz).toISOString();
}

/** Rückweg, damit das Formular denselben Wert zeigt, der gespeichert wurde. */
export function utcNachBerlinFeld(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(" ", "T");
}
