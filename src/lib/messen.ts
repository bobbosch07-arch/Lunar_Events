/**
 * Ereignisse an GA4 und Meta, falls zugestimmt (siehe `einwilligung.ts`).
 *
 * `gtag` und `fbq` existieren erst, wenn `Einwilligung.tsx` die Werkzeuge
 * nach einem Ja geladen hat. Vorher (oder nach einem Nein) tut hier alles
 * still nichts. Aufgerufen wird es aus `zaehle()`: Jedes Ereignis der
 * eigenen Zählung geht damit auch an GA4, unter dem Namen, den GA4 für
 * Ticketshops vorsieht (view_item, add_to_cart, begin_checkout, purchase).
 * Dadurch füllen sich dort die fertigen E-Commerce-Berichte.
 */
import { bereinigeAdresse, istSauber } from "./einwilligung";

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { disablePushState?: boolean };

declare global {
  interface Window {
    gtag?: Gtag;
    fbq?: Fbq;
    dataLayer?: unknown[];
  }
}

export type MessDaten = {
  /** Titel des Events, für die Berichte lesbarer als die ID. */
  titel?: string | null;
  /** Betrag in Euro (nicht Cent). */
  wert?: number | null;
  /** Bestellnummer, damit GA4 einen neu geladenen Kauf nicht doppelt zählt. */
  nummer?: string | null;
};

/** Unsere Namen → GA4- und Meta-Standardereignisse. */
const ZUORDNUNG: Record<string, { ga: string; meta: string | null }> = {
  event_gesehen: { ga: "view_item", meta: "ViewContent" },
  ticket_gewaehlt: { ga: "add_to_cart", meta: "AddToCart" },
  kasse_begonnen: { ga: "begin_checkout", meta: "InitiateCheckout" },
  daten_erfasst: { ga: "add_shipping_info", meta: null },
  kauf_abgeschlossen: { ga: "purchase", meta: "Purchase" },
  vip_angefragt: { ga: "generate_lead", meta: "Lead" },
  newsletter: { ga: "sign_up", meta: "CompleteRegistration" },
};

export function messe(art: string, eventId: string | null | undefined, daten: MessDaten = {}) {
  if (typeof window === "undefined") return;
  const ziel = ZUORDNUNG[art];
  if (!ziel) return;

  // Beim Kauf mit Preis und Menge 1: Erst dann weist GA4 den Umsatz je
  // Event aus (itemRevenue), nicht nur gesamt.
  const artikel = eventId
    ? [
        {
          item_id: eventId,
          item_name: daten.titel ?? undefined,
          item_category: "Event",
          ...(art === "kauf_abgeschlossen" && daten.wert != null ? { price: daten.wert, quantity: 1 } : {}),
        },
      ]
    : undefined;

  if (window.gtag) {
    window.gtag("event", ziel.ga, {
      currency: "EUR",
      ...(daten.wert != null ? { value: daten.wert } : {}),
      ...(daten.nummer ? { transaction_id: daten.nummer } : {}),
      ...(artikel ? { items: artikel } : {}),
      page_location: bereinigeAdresse(location.href),
    });
  }

  // Meta liest die Adresse selbst aus und lässt sie sich nicht vorschreiben.
  // Auf Seiten mit Zugang in der Adresse geht deshalb gar nichts an Meta.
  if (window.fbq && ziel.meta && istSauber(location.href)) {
    window.fbq("track", ziel.meta, {
      currency: "EUR",
      ...(daten.wert != null ? { value: daten.wert } : {}),
      ...(eventId ? { content_ids: [eventId], content_type: "product" } : {}),
      ...(daten.titel ? { content_name: daten.titel } : {}),
    });
  }
}

/** Klick auf ein Element mit `data-messen="name"`. Nur GA4. */
export function messeKlick(name: string) {
  window.gtag?.("event", "klick", {
    ziel: name.slice(0, 60),
    page_location: bereinigeAdresse(location.href),
  });
}
