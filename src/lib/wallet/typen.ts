/**
 * Was ein Wallet-Pass über ein Ticket wissen muss.
 *
 * Beide Anbieter — Apple und Google — bekommen dieselben Angaben; nur
 * die Verpackung unterscheidet sich. Deshalb steht die Form hier einmal
 * und nicht zweimal.
 */
export type PassDaten = {
  /** Der Wert im QR-Code, identisch mit dem auf der Ticketseite. */
  code: string;
  eventTitel: string;
  /** Beginn in UTC (ISO). Wallet rechnet selbst in Ortszeit um. */
  beginn: string;
  einlass: string | null;
  ortName: string;
  ortStadt: string;
  ortStrasse: string | null;
  lat: number | null;
  lng: number | null;
  ticketArt: string;
  gastName: string | null;
  platz: string | null;
  bestellnummer: string;
  /** Für "Tickets ansehen" im Pass. */
  ticketLink: string;
  vip: boolean;
};

/** Farben, die beide Anbieter in eigener Schreibweise brauchen. */
export const PASS_FARBEN = {
  hintergrundRgb: "rgb(7, 17, 31)",
  schriftRgb: "rgb(248, 247, 243)",
  nebenschriftRgb: "rgb(212, 184, 115)",
  hintergrundHex: "#07111F",
} as const;
