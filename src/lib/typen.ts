/**
 * Die Begriffe der Anwendung. Diese Typen sind die Wahrheit — die
 * Datenbank-Migrationen bilden genau sie ab, nicht umgekehrt.
 */

export const KATEGORIEN = ["club", "party", "festival", "rooftop", "special"] as const;
export type Kategorie = (typeof KATEGORIEN)[number];

export const EVENT_STATUS = ["entwurf", "veroeffentlicht", "abgesagt", "archiviert"] as const;
export type EventStatus = (typeof EVENT_STATUS)[number];

/** Ticketarten. "vip" wird angefragt statt gekauft — deshalb ein eigener Typ. */
export const TICKET_ART = ["standard", "vip"] as const;
export type TicketArt = (typeof TICKET_ART)[number];

export const BESTELL_STATUS = [
  "offen", // reserviert, noch nicht bezahlt
  "bezahlt",
  "storniert",
  "erstattet",
  "abgelaufen", // Reservierung ist verfallen
] as const;
export type BestellStatus = (typeof BESTELL_STATUS)[number];

export const TICKET_STATUS = ["gueltig", "entwertet", "storniert"] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];

export const ZAHLUNGSART = ["stripe", "paypal", "abendkasse", "frei"] as const;
export type Zahlungsart = (typeof ZAHLUNGSART)[number];

export const ANFRAGE_STATUS = ["neu", "in_bearbeitung", "angebot", "bestaetigt", "abgelehnt"] as const;
export type AnfrageStatus = (typeof ANFRAGE_STATUS)[number];

/** Rabattcodes wirken je Ticket und nur auf den Ticketpreis (0016). */
export const RABATT_ART = ["prozent", "betrag"] as const;
export type RabattArt = (typeof RABATT_ART)[number];

/* ------------------------------------------------------------------ */

export type Ort = {
  id: string;
  name: string;
  stadt: string;
  strasse: string | null;
  plz: string | null;
  land: string;
  /** Fuer die Anfahrt; Kartenanbieter kommt spaeter. */
  lat: number | null;
  lng: number | null;
};

export type EventBild = {
  pfad: string;
  alt: string | null;
  /** Position des Motivs, damit Gesichter beim Zuschneiden nicht abgeschnitten werden. */
  fokus: string | null;
};

export type Veranstaltung = {
  id: string;
  slug: string;
  titel: string;
  untertitel: string | null;
  /** Kurzer Satz fuer Karten und Vorschauen. */
  teaser: string | null;
  beschreibung: string | null;
  kategorie: Kategorie;
  status: EventStatus;
  /** Beide in UTC gespeichert, angezeigt wird Europe/Berlin. */
  beginn: string;
  einlass: string | null;
  ende: string | null;
  ort: Ort;
  bild: EventBild | null;
  mindestalter: number | null;
  dresscode: string | null;
  veranstalter: string;
  /** Abendkasse ist eine Zusage — deshalb ausdruecklich, nicht erschlossen. */
  abendkasse: boolean;
  abendkasse_hinweis: string | null;
  /** Auf der Startseite herausgestellt. */
  featured: boolean;
  /** Abgeleitet, nicht gespeichert: guenstigste sichtbare Phase. */
  ab_preis_cent: number | null;
  vip_verfuegbar: boolean;
  ausverkauft: boolean;
  /** Nur gesetzt, wenn Fast Lane angeboten wird und noch Plätze hat. */
  fastlane?: FastLane | null;
  /** Ab hier kauft, wer Presale-Zugang hat (0019). */
  presale_ab?: string | null;
  /** Ab hier kauft jeder. null = Verkauf offen. */
  verkauf_ab?: string | null;
};

/**
 * Wie der Verkauf eines Events gerade steht und ob dieser Besuch Zugang
 * hat — die Antwort von pruefe_presale_zugang().
 */
export type VerkaufsStand =
  | { verkauf: "offen" }
  | { verkauf: "bald"; presale_ab: string | null; verkauf_ab: string }
  | { verkauf: "presale"; verkauf_ab: string; zugang: "einladung"; email: string }
  | { verkauf: "presale"; verkauf_ab: string; zugang: "code"; code: string }
  | {
      verkauf: "presale";
      verkauf_ab: string;
      zugang: null;
      grund?: "unbekannt" | "aufgebraucht" | null;
    };

/**
 * Kommt der Verkaufsstart noch? Nur dann lohnt die Frage nach Presale und
 * Zugang — ohne verkauf_ab verkauft ein Event wie bisher.
 */
export function verkaufsstartKommt(
  event: { verkauf_ab?: string | null },
  jetzt: number = Date.now(),
): boolean {
  return Boolean(event.verkauf_ab && new Date(event.verkauf_ab).getTime() > jetzt);
}

/** Das Fast-Lane-Upgrade, wie die Kasse es anbietet. */
export type FastLane = {
  preis_cent: number;
  /** Freie Plätze, null = unbegrenzt. */
  rest: number | null;
  beschreibung: string | null;
};

/**
 * Eine Ticketphase ist das, was im Detail zur Auswahl steht:
 * Early Bird, Phase 2, Standard, Last Chance, VIP.
 * Ausverkaufte Phasen bleiben sichtbar — das ist Absicht (Briefing 12).
 */
export type Phase = {
  id: string;
  event_id: string;
  name: string;
  art: TicketArt;
  preis_cent: number;
  /** Gebuehr, die auf den Preis kommt. Null = keine. */
  gebuehr_cent: number;
  kontingent: number | null;
  verkauft: number;
  /** Zeitfenster, in dem die Phase kaufbar ist. */
  ab: string | null;
  bis: string | null;
  /** Was drin ist — eine Zeile je Leistung. */
  leistungen: string[];
  beschreibung: string | null;
  position: number;
  aktiv: boolean;
};

/** Abgeleiteter Zustand einer Phase zum Zeitpunkt der Anzeige. */
export type PhasenZustand =
  | { art: "kaufbar"; rest: number | null }
  | { art: "ausverkauft" }
  | { art: "spaeter"; ab: string }
  | { art: "vorbei" }
  | { art: "anfrage" }
  /** Hätte Tickets, ist aber noch nicht dran: eine frühere Phase läuft. */
  | { art: "folgt"; nach: string };

export type Kunde = {
  id: string;
  email: string;
  vorname: string | null;
  nachname: string | null;
  telefon: string | null;
  /** Verknuepft mit auth.users, sobald sich jemand anmeldet. Gastkaeufe haben null. */
  user_id: string | null;
};

export type BestellPosition = {
  id: string;
  phase_id: string;
  phase_name: string;
  menge: number;
  einzelpreis_cent: number;
  gebuehr_cent: number;
};

export type Bestellung = {
  id: string;
  /** Menschenlesbar, steht auf Ticket und Beleg: LUN-4471-09 */
  nummer: string;
  event_id: string;
  kunde: Kunde;
  status: BestellStatus;
  positionen: BestellPosition[];
  summe_cent: number;
  gebuehr_cent: number;
  gesamt_cent: number;
  zahlungsart: Zahlungsart | null;
  /** Fremdschluessel beim Zahlungsanbieter, fuer Abgleich und Erstattung. */
  zahlung_ref: string | null;
  /** Reservierung verfaellt, wenn bis dahin nicht bezahlt wurde. */
  reserviert_bis: string | null;
  erstellt_am: string;
  bezahlt_am: string | null;
};

export type Ticket = {
  id: string;
  bestellung_id: string;
  event_id: string;
  phase_id: string;
  phase_name: string;
  art: TicketArt;
  /** Der Wert im QR-Code. Zufaellig, nicht ableitbar aus der Ticket-ID. */
  code: string;
  status: TicketStatus;
  gast_name: string | null;
  entwertet_am: string | null;
  entwertet_von: string | null;
  /** Bei VIP: Tischnummer o.ae. */
  platz: string | null;
};

export type Rabattcode = {
  id: string;
  /** Immer in Großbuchstaben. */
  code: string;
  art: RabattArt;
  /** Prozent 1–100 oder Cent je Ticket. */
  wert: number;
  /** null = alle Events */
  event_id: string | null;
  /** null = alle Phasen des Events */
  phasen_ids: string[] | null;
  gueltig_ab: string | null;
  gueltig_bis: string | null;
  /** Höchstzahl rabattierter Tickets, null = unbegrenzt */
  max_tickets: number | null;
  /** Rabattierte Tickets in offenen und bezahlten Bestellungen */
  eingeloest: number;
  /** Je E-Mail-Adresse — eine echte Sperre ist das nicht. */
  einmal_pro_person: boolean;
  aktiv: boolean;
  notiz: string | null;
  erstellt_am: string;
  /** Gehört der Code einem Promoter, zählen seine Einlösungen für ihn. */
  promoter_id: string | null;
  /** Öffnet den Presale; dann darf der Rabatt auch 0 sein. */
  oeffnet_presale: boolean;
};

/**
 * Ein Promoter wird nicht bezahlt, nur gezählt (0017). Zugeordnet wird
 * über seinen Link (?promo=kuerzel, nur im selben Besuch) oder seinen Code.
 */
export type Promoter = {
  id: string;
  name: string;
  /** Steht im Link: ?promo=max */
  kuerzel: string;
  /** Der geheime Teil des Statistik-Links */
  token: string;
  aktiv: boolean;
  notiz: string | null;
  erstellt_am: string;
};

/** Was promoter_statistik() liefert — und damit alles, was ein Promoter sieht. */
export type PromoterStatistik = {
  name: string;
  kuerzel: string;
  aktiv: boolean;
  events: Array<{
    id: string;
    titel: string;
    slug: string;
    beginn: string;
    kommend: boolean;
    klicks: number;
    tickets: number;
  }>;
  codes: Array<{ code: string; art: RabattArt; wert: number; event_id: string | null }>;
};

/**
 * Was die Kasse über einen eingegebenen Code erfährt. Die Gründe decken
 * sich mit den Meldungen von pruefe_rabattcode() und reserviere().
 */
export type CodeVorschau =
  | {
      ergebnis: "ok";
      code: string;
      art: RabattArt;
      wert: number;
      rabatt_cent: number;
      /** Tickets mit Rabatt … */
      tickets: number;
      /** … von so vielen gewählten. Weniger, wenn die Obergrenze greift. */
      tickets_gesamt: number;
      oeffnet_presale: boolean;
    }
  | { ergebnis: "noch_nicht"; ab: string }
  | {
      ergebnis:
        | "unbekannt"
        | "abgelaufen"
        | "anderes_event"
        | "aufgebraucht"
        | "passt_nicht"
        | "schon_genutzt";
    };

export type CodeAblehnung = Exclude<CodeVorschau, { ergebnis: "ok" }>;

export type VipAnfrage = {
  id: string;
  event_id: string | null;
  name: string;
  email: string;
  telefon: string | null;
  gaeste: number;
  wunschdatum: string | null;
  paket: string | null;
  nachricht: string | null;
  status: AnfrageStatus;
  erstellt_am: string;
  notiz_intern: string | null;
};

/* ------------------------------------------------------------------ */

/** Preis in Cent → "39,00 €" ueberlassen wir der Anzeige; hier nur Rechnen. */
export function positionSumme(p: BestellPosition): number {
  return (p.einzelpreis_cent + p.gebuehr_cent) * p.menge;
}

export function phasenPreisGesamt(p: Phase): number {
  return p.preis_cent + p.gebuehr_cent;
}

/**
 * Der Zustand einer Phase haengt an Zeit UND Kontingent. Beides an einer
 * Stelle zu beantworten verhindert, dass Liste, Detail und Kasse zu
 * unterschiedlichen Ergebnissen kommen.
 */
export function phasenZustand(p: Phase, jetzt: Date = new Date()): PhasenZustand {
  if (p.art === "vip") return { art: "anfrage" };
  if (!p.aktiv) return { art: "vorbei" };

  if (p.ab && new Date(p.ab) > jetzt) return { art: "spaeter", ab: p.ab };
  if (p.bis && new Date(p.bis) < jetzt) return { art: "vorbei" };

  if (p.kontingent !== null) {
    const rest = p.kontingent - p.verkauft;
    if (rest <= 0) return { art: "ausverkauft" };
    return { art: "kaufbar", rest };
  }
  return { art: "kaufbar", rest: null };
}

/**
 * Restmenge nur dann als Zahl zeigen, wenn sie wirklich knapp ist.
 * Kein erfundener Druck (Briefing 28/29) — aber echte Knappheit verschweigen
 * waere auch falsch.
 */
export const KNAPP_AB = 25;

export function zeigeRest(z: PhasenZustand): number | null {
  if (z.art !== "kaufbar") return null;
  if (z.rest === null) return null;
  return z.rest <= KNAPP_AB ? z.rest : null;
}

/** Reihenfolge der Phasen — dieselbe wie in `reserviere()` (0010). */
export function phasenFolge(a: Phase, b: Phase): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Zustände aller Phasen eines Events, **mit** Reihenfolge.
 *
 * `phasenZustand` beurteilt eine Phase für sich allein und hielt deshalb
 * Early Bird, Phase 2 und Standard gleichzeitig für kaufbar. Kaufbar ist
 * aber immer nur die erste Standardphase, die noch Tickets hat — die
 * späteren sind sichtbar und „folgen". Sonst nimmt niemand Phase 2 für
 * 39 €, solange Early Bird für 29 € offen ist.
 *
 * Die Datenbank prüft dasselbe noch einmal (`reserviere`, 0010), denn die
 * Auswahl steht in der Adresse und lässt sich von Hand ändern.
 */
export function phasenZustaende(
  phasen: Phase[],
  jetzt: Date = new Date(),
): Map<string, PhasenZustand> {
  const ergebnis = new Map<string, PhasenZustand>();
  let aktuelle: Phase | null = null;

  for (const p of [...phasen].sort(phasenFolge)) {
    const zustand = phasenZustand(p, jetzt);
    if (p.art !== "standard" || zustand.art !== "kaufbar") {
      ergebnis.set(p.id, zustand);
    } else if (aktuelle) {
      ergebnis.set(p.id, { art: "folgt", nach: aktuelle.name });
    } else {
      aktuelle = p;
      ergebnis.set(p.id, zustand);
    }
  }
  return ergebnis;
}

/**
 * Was die Verkaufsleiste unter der aktuellen Phase zeigt.
 *
 * Nur echte Zahlen (Briefing: Dringlichkeit „nur aus wahrheitsgemäßer
 * Verfügbarkeit"). Erscheint erst ab der Hälfte — eine Leiste bei 8 %
 * sagte „hier will keiner hin" und wäre das Gegenteil von dem, wofür sie
 * da ist. Ohne Kontingent gibt es nichts zu füllen, also keine Leiste.
 */
export const LEISTE_AB = 0.5;

export type Verkaufsstand = {
  anteil: number;
  rest: number;
  /** Die Phase danach, mit ihrem Preis — der ehrlichste Grund, jetzt zu kaufen. */
  naechste: Phase | null;
};

export function verkaufsstand(
  phase: Phase,
  phasen: Phase[],
  zustaende: Map<string, PhasenZustand>,
): Verkaufsstand | null {
  if (zustaende.get(phase.id)?.art !== "kaufbar" || phase.kontingent === null) return null;
  if (phase.kontingent === 0) return null;

  const anteil = phase.verkauft / phase.kontingent;
  if (anteil < LEISTE_AB) return null;

  const naechste =
    [...phasen]
      .sort(phasenFolge)
      .find((p) => p.art === "standard" && zustaende.get(p.id)?.art === "folgt") ?? null;

  return { anteil, rest: phase.kontingent - phase.verkauft, naechste };
}
