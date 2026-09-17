/**
 * Rabattcodes — was Browser und Server gleichermaßen brauchen.
 *
 * Gerechnet wird hier nichts. Der Betrag kommt immer aus der Datenbank
 * (code_rabatt() in 0016), damit Anzeige und Abbuchung nicht
 * auseinanderlaufen können.
 */
import { preisText } from "./format";
import { utcNachBerlinFeld } from "./zeit";
import type { Rabattcode, RabattArt } from "./typen";

/** Dieselbe Regel wie rabattcodes_code_form in der Datenbank. */
export const CODE_MUSTER = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalisiereCode(roh: string): string {
  return roh.trim().toUpperCase();
}

/** "20 %" oder "5 € je Ticket" */
export function rabattText(art: RabattArt, wert: number, locale = "de"): string {
  if (wert === 0) return locale === "en" ? "presale only" : "nur Presale";
  if (art === "prozent") return `${wert} %`;
  return `${preisText(wert, locale)} ${locale === "en" ? "per ticket" : "je Ticket"}`;
}

export type CodeZustand = "aktiv" | "pausiert" | "geplant" | "abgelaufen" | "aufgebraucht";

/** Wie das Backoffice einen Code auf einen Blick einordnet. */
export function codeZustand(code: Rabattcode, jetzt = Date.now()): CodeZustand {
  if (!code.aktiv) return "pausiert";
  if (code.gueltig_bis && new Date(code.gueltig_bis).getTime() < jetzt) return "abgelaufen";
  if (code.max_tickets !== null && code.eingeloest >= code.max_tickets) return "aufgebraucht";
  if (code.gueltig_ab && new Date(code.gueltig_ab).getTime() > jetzt) return "geplant";
  return "aktiv";
}

/* ------------------------------------------------------------------ */
/* Code aus einem Link merken                                          */
/* ------------------------------------------------------------------ */

/**
 * Wer über einen Link mit ?code= kommt, sieht sich oft erst ein wenig um,
 * bevor er kauft. Der Code wird deshalb für die Sitzung gemerkt — nur in
 * diesem Tab und nur bis er geschlossen wird. Kein Cookie: Der Code geht
 * niemanden außer der Kasse etwas an.
 */
const SPEICHER = "lunar_code";

export function merkeCodeAusAdresse(): void {
  try {
    const roh = new URLSearchParams(window.location.search).get("code");
    if (!roh) return;
    const code = normalisiereCode(roh);
    if (CODE_MUSTER.test(code)) sessionStorage.setItem(SPEICHER, code);
  } catch {
    // Privater Modus o. ä. — dann eben ohne Merken.
  }
}

export function merkeCode(code: string): void {
  try {
    sessionStorage.setItem(SPEICHER, code);
  } catch {}
}

export function gemerkterCode(): string | null {
  try {
    return sessionStorage.getItem(SPEICHER);
  } catch {
    return null;
  }
}

export function vergissCode(): void {
  try {
    sessionStorage.removeItem(SPEICHER);
  } catch {}
}

/**
 * Die persönliche Presale-Einladung aus der Mail (?einladung=…). Gemerkt wie
 * ein Code: Der Gast hat sie selbst angeklickt, um zu kaufen — ohne Merken
 * ginge sie beim Sprung auf „Tickets kaufen" verloren.
 */
const EINLADUNG = "lunar_einladung";

export function merkeEinladungAusAdresse(): void {
  try {
    const roh = new URLSearchParams(window.location.search).get("einladung");
    if (roh && /^[0-9a-f]{32,128}$/.test(roh)) sessionStorage.setItem(EINLADUNG, roh);
  } catch {}
}

export function gemerkteEinladung(): string | null {
  try {
    return sessionStorage.getItem(EINLADUNG);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Formularstand fürs Backoffice                                       */
/* ------------------------------------------------------------------ */

/**
 * Was das Code-Formular in seinen Feldern hält — Text, so wie getippt.
 * Steht hier und nicht im Formular: Werte aus einer "use client"-Datei
 * kommen in einer Server-Komponente nur als Platzhalter an.
 */
export type RabattcodeStand = {
  id?: string;
  code: string;
  art: RabattArt;
  /** "20" bei Prozent, "5,00" bei Betrag */
  wertText: string;
  /** "" = alle Events */
  eventId: string;
  phasenIds: string[];
  /** datetime-local in Berliner Zeit, "" = offen */
  gueltigAb: string;
  gueltigBis: string;
  /** "" = unbegrenzt */
  maxTickets: string;
  einmalProPerson: boolean;
  aktiv: boolean;
  notiz: string;
  /** "" = gehört keinem Promoter */
  promoterId: string;
  oeffnetPresale: boolean;
};

export const LEERER_CODE: RabattcodeStand = {
  code: "",
  art: "prozent",
  wertText: "",
  eventId: "",
  phasenIds: [],
  gueltigAb: "",
  gueltigBis: "",
  maxTickets: "",
  einmalProPerson: false,
  aktiv: true,
  notiz: "",
  promoterId: "",
  oeffnetPresale: false,
};

export function codeStandAus(code: Rabattcode): RabattcodeStand {
  return {
    id: code.id,
    code: code.code,
    art: code.art,
    wertText:
      code.art === "prozent" ? String(code.wert) : (code.wert / 100).toFixed(2).replace(".", ","),
    eventId: code.event_id ?? "",
    phasenIds: code.phasen_ids ?? [],
    gueltigAb: code.gueltig_ab ? utcNachBerlinFeld(code.gueltig_ab) : "",
    gueltigBis: code.gueltig_bis ? utcNachBerlinFeld(code.gueltig_bis) : "",
    maxTickets: code.max_tickets === null ? "" : String(code.max_tickets),
    einmalProPerson: code.einmal_pro_person,
    aktiv: code.aktiv,
    notiz: code.notiz ?? "",
    promoterId: code.promoter_id ?? "",
    oeffnetPresale: code.oeffnet_presale,
  };
}
