import type { Rolle } from "./rollen";

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
  /** null bei Tickets von der Gästeliste (0021) — dann ist gast_id gesetzt. */
  bestellung_id: string | null;
  event_id: string;
  phase_id: string | null;
  gast_id: string | null;
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

/* ------------------------------------------------------------------ */

/**
 * Ein Eintrag auf der Gästeliste (0021). Er erzeugt ein Ticket je Person —
 * QR-Scan und Namensliste entwerten dieselben Tickets. Die Gästeliste kommt
 * obendrauf und zieht nichts von den Phasenkontingenten ab.
 */
export type Gast = {
  id: string;
  event_id: string;
  name: string;
  email: string | null;
  /** Wie viele Personen zusätzlich mitkommen: +1, +2 … */
  begleitung: number;
  notiz: string | null;
  /** Zugang zur Ticketseite: /tickets/<token> */
  token: string;
  mail_gesendet_am: string | null;
  /** Personen mit gültigem oder eingelöstem Ticket */
  personen: number;
  /** Davon schon drin */
  drin: number;
};

export const GAST_MAX_BEGLEITUNG = 10;

/* ------------------------------------------------------------------ */

/**
 * Warteliste (0020). Die Zahlen stehen genauso in der Migration — die
 * Anzahl als check-Regel, die Frist in angebot_frist().
 */
export const WARTELISTE_MAX_TICKETS = 4;
export const ANGEBOT_STUNDEN = 4;

/**
 * Darf man sich auf die Warteliste setzen? Dieselbe Regel wie
 * ist_ausverkauft() in der Datenbank: Es gibt Standardphasen, und keine hat
 * noch Tickets oder bekommt welche. Eine Phase, deren Verkauf erst beginnt,
 * zählt als „kommt noch" — dann gibt es keine Warteliste, sondern ein Datum.
 */
export function wartelisteOffen(phasen: Phase[], jetzt: Date = new Date()): boolean {
  const standard = phasen.filter((p) => p.art === "standard");
  if (standard.length === 0) return false;
  return !standard.some(
    (p) =>
      p.aktiv &&
      (p.bis === null || new Date(p.bis) >= jetzt) &&
      (p.kontingent === null || p.verkauft < p.kontingent),
  );
}

export type WartelisteZustand =
  | "unbestaetigt"
  | "wartet"
  /** Reserviert, die Frist läuft */
  | "angeboten"
  /** Per Überweisung bestellt, Zahlung steht aus */
  | "ueberweisung"
  | "gekauft"
  /** Frist abgelaufen — raus aus der Liste */
  | "verfallen"
  | "ausgetragen";

/**
 * Der Zustand eines Eintrags wird nicht gespeichert, sondern aus Eintrag
 * und Angebots-Bestellung abgeleitet — sonst gäbe es zwei Wahrheiten, die
 * auseinanderlaufen, sobald eine Reservierung verfällt.
 */
export function wartelisteZustand(
  eintrag: { bestaetigt_am: string | null; ausgetragen_am: string | null; angebot_am: string | null },
  bestellung: { status: string; vorkasse: boolean; reserviert_bis: string | null } | null,
  jetzt: Date = new Date(),
): WartelisteZustand {
  if (bestellung?.status === "bezahlt") return "gekauft";
  if (eintrag.ausgetragen_am) return "ausgetragen";
  if (!eintrag.bestaetigt_am) return "unbestaetigt";
  if (!eintrag.angebot_am) return "wartet";
  if (bestellung?.status === "offen") {
    if (bestellung.vorkasse) return "ueberweisung";
    // Der Aufräumlauf kommt nur alle fünf Minuten — was abgelaufen ist, ist
    // abgelaufen, auch wenn der Status noch "offen" sagt.
    if (!bestellung.reserviert_bis || new Date(bestellung.reserviert_bis) > jetzt) {
      return "angeboten";
    }
  }
  return "verfallen";
}

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

/* ------------------------------------------------------------------ */

/**
 * Eine Schicht (Migration 0023). Die Rolle steht an der Schicht, nicht nur
 * an der Person: Wer sonst an der Bar steht, kann heute Runner sein. Rechte
 * vergibt ein Schichtplan keine — die hängen an `mitarbeiter.rolle`.
 */
export type Schicht = {
  id: string;
  event_id: string;
  user_id: string;
  rolle: Rolle;
  station: string | null;
  beginn: string;
  ende: string;
  pause_min: number;
  notiz: string | null;
  eingecheckt_am: string | null;
  ausgecheckt_am: string | null;
  plan_gesendet_am: string | null;
};

/**
 * Stunden einer Schicht — dieselbe Rechnung wie `schicht_stunden()` in der
 * Datenbank (0024): Gemessen wird nur, wenn ein- **und** ausgecheckt ist,
 * sonst gilt die geplante Zeit. Sonst stünden 148 Stunden im Plan, wenn
 * jemand versehentlich Tage zu früh eingecheckt wird. Pause geht immer ab,
 * nie unter null.
 */
export function schichtStunden(s: {
  beginn: string;
  ende: string;
  pause_min: number;
  eingecheckt_am?: string | null;
  ausgecheckt_am?: string | null;
}): number {
  const gemessen = Boolean(s.eingecheckt_am && s.ausgecheckt_am);
  const von = new Date(gemessen ? s.eingecheckt_am! : s.beginn).getTime();
  const bis = new Date(gemessen ? s.ausgecheckt_am! : s.ende).getTime();
  const stunden = (bis - von) / 3_600_000 - s.pause_min / 60;
  return Math.max(0, Math.round(stunden * 100) / 100);
}

/** Geplant, angefangen oder fertig — für die Anzeige. */
export function schichtStand(s: {
  eingecheckt_am?: string | null;
  ausgecheckt_am?: string | null;
}): "geplant" | "laeuft" | "fertig" {
  if (s.ausgecheckt_am) return "fertig";
  if (s.eingecheckt_am) return "laeuft";
  return "geplant";
}
