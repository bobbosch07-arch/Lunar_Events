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

/**
 * Farben, die beide Anbieter in eigener Schreibweise brauchen.
 * Violett-Nacht (30.09.2026): Nacht als Grund, Lila-Weiß als Schrift,
 * Beschriftungen in Mondgelb — dieselben Werte wie in tokens.css.
 */
export const PASS_FARBEN = {
  hintergrundRgb: "rgb(34, 10, 79)",
  schriftRgb: "rgb(247, 240, 255)",
  nebenschriftRgb: "rgb(255, 225, 74)",
  hintergrundHex: "#220A4F",
} as const;
