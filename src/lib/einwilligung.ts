/**
 * Einwilligung für Statistik (GA4) und Marketing (Meta-Pixel), 03.10.2026.
 *
 * Rechtslage, kurz: Werkzeuge, die auf dem Gerät speichern oder lesen und
 * nicht unbedingt nötig sind, laden erst **nach** einem Ja (§ 25 TDDDG,
 * Art. 6 Abs. 1 lit. a DSGVO). Ablehnen muss genauso einfach sein wie
 * Annehmen, und widerrufen jederzeit (Link „Cookie-Einstellungen“ im Fuß).
 * Die Entscheidung selbst zu speichern ist unbedingt nötig und braucht
 * keine Einwilligung.
 *
 * Die eigene Zählung (`ereignisse`, `Zaehler.tsx`) läuft davon unberührt
 * weiter: ohne Cookie und ohne Personenbezug, also auch für alle, die
 * ablehnen. Sie bleibt die vollständige Zahl; GA4 zeigt zusätzlich
 * Besucher und Wege derer, die zustimmen.
 *
 * Kein "use client": Geteilt zwischen Banner, Messung und Datenschutzseite.
 */

export type Kategorie = "statistik" | "marketing";

export type Einwilligung = {
  statistik: boolean;
  marketing: boolean;
  /** Welche Kategorien zur Wahl standen. Kommt eine dazu, wird neu gefragt. */
  angeboten: Kategorie[];
  /** Zeitpunkt der Entscheidung (Nachweis). */
  am: string;
};

export const EINWILLIGUNG_KEKS = "lunar_einwilligung";
/** Zwölf Monate, dann fragt der Banner neu. */
const LAUFZEIT_SEK = 60 * 60 * 24 * 365;

/** Ereignis, mit dem der Fuß-Link den Banner wieder öffnet. */
export const EINWILLIGUNG_OEFFNEN = "lunar:einwilligung-oeffnen";

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID?.trim() || null;
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || null;

/** Nur Kategorien mit eingerichtetem Werkzeug stehen zur Wahl. */
export function angeboteneKategorien(): Kategorie[] {
  return [GA_ID ? "statistik" : null, META_PIXEL_ID ? "marketing" : null].filter(
    Boolean,
  ) as Kategorie[];
}

/** Ereignis nach jedem Speichern, damit der Banner sofort Bescheid weiß. */
export const EINWILLIGUNG_GEAENDERT = "lunar:einwilligung-geaendert";

/** Der rohe Cookie-Wert; ein String, damit React ihn vergleichen kann. */
export function leseKeks(): string | null {
  if (typeof document === "undefined") return null;
  return (
    document.cookie
      .split("; ")
      .find((z) => z.startsWith(`${EINWILLIGUNG_KEKS}=`))
      ?.slice(EINWILLIGUNG_KEKS.length + 1) ?? null
  );
}

export function leseEinwilligung(): Einwilligung | null {
  return deuteEinwilligung(leseKeks());
}

export function deuteEinwilligung(roh: string | null): Einwilligung | null {
  if (!roh) return null;
  try {
    const e = JSON.parse(decodeURIComponent(roh)) as Partial<Einwilligung>;
    if (typeof e.statistik !== "boolean" || typeof e.marketing !== "boolean") return null;
    return {
      statistik: e.statistik,
      marketing: e.marketing,
      angeboten: Array.isArray(e.angeboten) ? e.angeboten : [],
      am: String(e.am ?? ""),
    };
  } catch {
    return null;
  }
}

export function speichereEinwilligung(wahl: { statistik: boolean; marketing: boolean }): Einwilligung {
  const e: Einwilligung = {
    statistik: wahl.statistik,
    marketing: wahl.marketing,
    angeboten: angeboteneKategorien(),
    am: new Date().toISOString(),
  };
  const sicher = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${EINWILLIGUNG_KEKS}=${encodeURIComponent(JSON.stringify(e))}; Max-Age=${LAUFZEIT_SEK}; Path=/; SameSite=Lax${sicher}`;
  window.dispatchEvent(new Event(EINWILLIGUNG_GEAENDERT));
  return e;
}

/** Muss der Banner fragen? Ja, wenn nie entschieden oder etwas Neues dazukam. */
export function mussFragen(e: Einwilligung | null): boolean {
  const angeboten = angeboteneKategorien();
  if (angeboten.length === 0) return false;
  if (!e) return true;
  return angeboten.some((k) => !e.angeboten.includes(k));
}

/**
 * Werkzeuge des Personals: kein Banner, keine Messung. Dort arbeitet das
 * Team, Kundenverhalten gibt es da nicht zu sehen.
 */
const INTERN = /^\/(?:en\/)?(?:backoffice|kasse|einlass|garderobe|plan|styleguide)(?:\/|$)/;

export function istInternerPfad(pfad: string): boolean {
  return INTERN.test(pfad);
}

/**
 * Pfade, deren letzter Teil ein Zugang ist: Wer `/tickets/<token>` hat,
 * kommt rein. Solche Adressen dürfen nie zu Google oder Meta.
 */
const GEHEIM = /^(\/(?:en\/)?(?:tickets|warteliste|promoter|kasse\/zahlen|newsletter\/bestaetigen|newsletter\/abmelden|werbung\/abmelden))\/[^/?#]+/;

/** Von den Parametern bleibt nur, was Kampagnen auswertbar macht. */
const ERLAUBT = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "promo"]);

/**
 * Macht eine Adresse vorzeigbar: Zugänge im Pfad werden zu `_`, von den
 * Parametern bleiben nur Kampagne und Promoter-Kürzel. Alles andere
 * (`token_hash`, `einladung`, `code`, Stripes `payment_intent_client_secret`
 * …) fällt weg.
 */
export function bereinigeAdresse(href: string): string {
  try {
    const url = new URL(href);
    url.pathname = url.pathname.replace(GEHEIM, "$1/_");
    for (const name of [...url.searchParams.keys()]) {
      if (!ERLAUBT.has(name)) url.searchParams.delete(name);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Ob eine Adresse etwas enthält, das bereinigt werden müsste. */
export function istSauber(href: string): boolean {
  try {
    const roh = new URL(href);
    roh.hash = "";
    return bereinigeAdresse(href) === roh.toString();
  } catch {
    return false;
  }
}
