/**
 * Promoter — was Browser und Server gleichermaßen brauchen.
 *
 * Zugeordnet wird nur im selben Besuch: Das Kürzel reist in der Adresse
 * (?promo=…) von der Eventseite bis in die Kasse. Gespeichert wird dafür
 * nichts auf dem Gerät — das war die Bedingung, um ohne
 * Einwilligungsdialog auszukommen. Wer das in einen Cookie oder den
 * Browserspeicher legt, braucht vorher einen Banner.
 */
import type { Promoter, PromoterStatistik } from "./typen";

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
): Array<{ eventId: string; titel: string; datum: string; link: string; code: string | null }> {
  const datum = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    timeZone: "Europe/Berlin",
  });
  return statistik.events
    .filter((e) => e.kommend)
    .sort((a, b) => a.beginn.localeCompare(b.beginn))
    .map((e) => {
      const code =
        statistik.codes.find((c) => c.event_id === e.id)?.code ??
        statistik.codes.find((c) => c.event_id === null)?.code ??
        null;
      return {
        eventId: e.id,
        titel: e.titel,
        datum: datum.format(new Date(e.beginn)),
        link: promoterLink(adresse, e.slug, statistik.kuerzel, code),
        code,
      };
    });
}
