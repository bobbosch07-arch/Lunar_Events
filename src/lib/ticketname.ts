/**
 * Namen auf Tickets (0046). Am Einlass werden Ausweise kontrolliert, also
 * trägt jedes gekaufte Ticket Vor- und Nachnamen der Person, die damit
 * kommt. Dieselbe Regel steht in der Datenbank als `ist_ticketname()`; hier
 * prüft sie zusätzlich, dass Vor- und Nachname Buchstaben enthalten.
 */

export const TICKETNAME_MAX = 80;

/** Leerzeichen zusammenfassen und außen abschneiden, wie die Datenbank. */
export function bereinigeName(roh: string): string {
  return String(roh ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Erwartet einen bereinigten Namen. */
export function istTicketname(name: string): boolean {
  if (name.length < 3 || name.length > TICKETNAME_MAX) return false;
  if (/\p{Cc}/u.test(name)) return false;
  const teile = name.split(" ");
  return teile.length >= 2 && teile.filter((t) => /\p{L}/u.test(t)).length >= 2;
}

/**
 * Ein Ticket gilt für eine Person: Steht ein Name zweimal in einer
 * Bestellung, ist er ab dem zweiten Mal hier markiert.
 */
export function doppelteNamen(namen: string[]): boolean[] {
  const gesehen = new Set<string>();
  return namen.map((n) => {
    const schluessel = bereinigeName(n).toLocaleLowerCase("de");
    if (!schluessel) return false;
    const doppelt = gesehen.has(schluessel);
    gesehen.add(schluessel);
    return doppelt;
  });
}
