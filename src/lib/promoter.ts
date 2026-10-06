/**
 * Promoter — was Browser und Server gleichermaßen brauchen.
 *
 * Zugeordnet wird nur im selben Besuch: Das Kürzel reist in der Adresse
 * (?promo=…) von der Eventseite bis in die Kasse. Gespeichert wird dafür
 * nichts auf dem Gerät — das war die Bedingung, um ohne
 * Einwilligungsdialog auszukommen. Wer das in einen Cookie oder den
 * Browserspeicher legt, braucht vorher einen Banner.
 */
import type { Promoter, PromoterStatistik, PromoterStufe } from "./typen";

/** Dieselbe Regel wie promoter_kuerzel_form in der Datenbank. */
export const KUERZEL_MUSTER = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** Name des Parameters im Link. Nicht "p" — das belegt die Kasse schon. */
export const PROMO_PARAMETER = "promo";

/** "Max Müller" → "max-mueller" */
export function kuerzelAus(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Ein gültiges Kürzel oder null — für Werte aus Adressen. */
export function pruefeKuerzel(roh: string | null | undefined): string | null {
  const kuerzel = roh?.trim().toLowerCase() ?? "";
  return KUERZEL_MUSTER.test(kuerzel) ? kuerzel : null;
}

/** Nur im Browser: das Kürzel aus der aktuellen Adresse. */
export function promoAusAdresse(): string | null {
  if (typeof window === "undefined") return null;
  return pruefeKuerzel(new URLSearchParams(window.location.search).get(PROMO_PARAMETER));
}

/** Der Link, den ein Promoter teilt. Mit Code, wenn er einen für das Event hat. */
export function promoterLink(
  adresse: string,
  eventSlug: string,
  kuerzel: string,
  code?: string | null,
): string {
  const suche = new URLSearchParams({ [PROMO_PARAMETER]: kuerzel });
  if (code) suche.set("code", code);
  return `${adresse}/events/${eventSlug}?${suche.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Formularstand fürs Backoffice                                       */
/* ------------------------------------------------------------------ */

/** Steht hier und nicht im Formular — siehe RabattcodeStand in rabatt.ts. */
export type PromoterStand = {
  id?: string;
  name: string;
  kuerzel: string;
  aktiv: boolean;
  notiz: string;
};

export const LEERER_PROMOTER: PromoterStand = {
  name: "",
  kuerzel: "",
  aktiv: true,
  notiz: "",
};

export function promoterStandAus(p: Promoter): PromoterStand {
  return {
    id: p.id,
    name: p.name,
    kuerzel: p.kuerzel,
    aktiv: p.aktiv,
    notiz: p.notiz ?? "",
  };
}

/**
 * Die Links, die ein Promoter teilen kann: einer je kommendem Event. Hat er
 * einen Code, der fürs Event gilt, steckt der mit drin — ein Code nur für
 * dieses Event hat Vorrang vor einem für alle.
 *
 * Backoffice und Promoterseite benutzen dieselbe Funktion, damit dort nie
 * unterschiedliche Links stehen.
 */
export function teilLinks(
  statistik: PromoterStatistik,
  adresse: string,
  locale = "de",
): Array<{
  eventId: string;
  titel: string;
  datum: string;
  link: string;
  code: string | null;
  /** false: Code ohne Rabatt, nur zur Zuordnung (0040). */
  mitRabatt: boolean;
}> {
  const datum = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    timeZone: "Europe/Berlin",
  });
  return statistik.events
    .filter((e) => e.kommend)
    .sort((a, b) => a.beginn.localeCompare(b.beginn))
    .map((e) => {
      const c =
        statistik.codes.find((x) => x.event_id === e.id) ??
        statistik.codes.find((x) => x.event_id === null) ??
        null;
      // Ein Code ohne Rabatt reist nicht im Link mit: Sonst sähe jeder Kauf
      // über den Link aus wie „Link und Code“, und der Abgleich, wer den
      // Code wirklich genannt hat, ginge verloren.
      const mitRabatt = Boolean(c && c.wert > 0);
      return {
        eventId: e.id,
        titel: e.titel,
        datum: datum.format(new Date(e.beginn)),
        link: promoterLink(adresse, e.slug, statistik.kuerzel, mitRabatt ? c!.code : null),
        code: c?.code ?? null,
        mitRabatt,
      };
    });
}

/* ------------------------------------------------------------------ */
/* Staffel (0040)                                                      */
/* ------------------------------------------------------------------ */

export type StaffelStand = {
  /** Erreichte Stufen, aufsteigend. Sie stapeln sich: alle gelten. */
  erreicht: PromoterStufe[];
  naechste: PromoterStufe | null;
  /** Tickets bis zur nächsten Stufe, 0 wenn alle erreicht. */
  fehlen: number;
  /** Fortschritt auf der ganzen Staffel, 0 bis 100. */
  anteil: number;
};

/**
 * Wo ein Promoter in der Staffel steht. Eine Rechnung für Promoterseite
 * und Backoffice, damit beide dieselbe Stufe zeigen.
 */
export function staffelStand(tickets: number, stufen: PromoterStufe[]): StaffelStand {
  const sortiert = [...stufen].sort((a, b) => a.ab - b.ab);
  const erreicht = sortiert.filter((s) => tickets >= s.ab);
  const naechste = sortiert.find((s) => tickets < s.ab) ?? null;
  const ziel = sortiert.at(-1)?.ab ?? 0;
  return {
    erreicht,
    naechste,
    fehlen: naechste ? naechste.ab - tickets : 0,
    anteil: ziel > 0 ? Math.min(100, (tickets / ziel) * 100) : 0,
  };
}
