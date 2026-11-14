import type { DirektBestaetigt, Kassenstand, TuerVerkauf, TuerZahlungStand } from "@/app/aktionen/kasse";
import type { KassenPhase } from "@/components/Kasse";

/**
 * Die Abendkasse der Crew-App spricht mit `/api/crew/kasse` (siehe dort,
 * warum keine Server-Aktionen). Alles mit Zeitgrenze: An der Tür ist eine
 * hängende Anfrage schlimmer als eine abgelehnte.
 */

export type CrewKassenDaten = {
  ergebnis: "ok";
  qrMoeglich: boolean;
  /** PayPal per paypal.me und Überweisung per GiroCode (0052) eingerichtet? */
  paypalDirekt: boolean;
  ueberweisung: boolean;
  /** Garderobe an der Abendkasse (0053): Preis je Stück, null = aus. */
  garderobeCent: number | null;
  stand: Kassenstand | null;
  phasen: KassenPhase[];
};

const ADRESSE = "/api/crew/kasse";

async function mitGrenze<T>(ms: number, anfrage: (signal: AbortSignal) => Promise<Response>): Promise<T | null> {
  const halt = new AbortController();
  const uhr = setTimeout(() => halt.abort(), ms);
  try {
    const r = await anfrage(halt.signal);
    if (r.status === 403) return { ergebnis: "keine_berechtigung" } as T;
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

function schicke<T>(ms: number, inhalt: unknown) {
  return mitGrenze<T>(ms, (signal) =>
    fetch(ADRESSE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inhalt),
      signal,
      cache: "no-store",
    }),
  );
}

export function crewKassenDaten(eventId: string) {
  return mitGrenze<CrewKassenDaten | { ergebnis: "keine_berechtigung" }>(8000, (signal) =>
    fetch(`${ADRESSE}?event=${encodeURIComponent(eventId)}`, { signal, cache: "no-store" }),
  );
}

/**
 * Verkaufen hat eine großzügige Grenze: Bricht das Gerät zu früh ab, ist der
 * Verkauf womöglich trotzdem gebucht — dann lieber etwas länger warten.
 */
export function crewVerkaufen(eingabe: {
  eventId: string;
  phaseId: string;
  menge: number;
  zahlung: "bar" | "qr" | "paypal" | "ueberweisung";
  einlassen: boolean;
  garderobe: number;
}) {
  return schicke<TuerVerkauf>(15000, { schritt: "verkaufen", ...eingabe });
}

export function crewZahlungStand(bestellungId: string, einlassen: boolean) {
  return schicke<TuerZahlungStand>(10000, { schritt: "zahlung", bestellungId, einlassen });
}

/** „Zahlung gesehen“ bei PayPal oder Überweisung direkt. */
export function crewDirektBestaetigen(bestellungId: string, einlassen: boolean) {
  return schicke<DirektBestaetigt>(10000, { schritt: "bestaetigen", bestellungId, einlassen });
}

export function crewVerkaufAbbrechen(bestellungId: string) {
  return schicke<{ ok: boolean }>(8000, { schritt: "abbrechen", bestellungId });
}
