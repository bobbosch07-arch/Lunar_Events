import Stripe from "stripe";

/**
 * Stripe auf dem Server. Der geheime Schlüssel darf niemals in eine
 * Client-Komponente geraten — deshalb liegt diese Datei bewusst nicht
 * neben den Komponenten.
 */
let zwischenspeicher: Stripe | null = null;

export function stripe(): Stripe {
  const schluessel = process.env.STRIPE_SECRET_KEY;
  if (!schluessel) {
    throw new Error("STRIPE_SECRET_KEY fehlt — ohne ihn keine Zahlungen.");
  }
  zwischenspeicher ??= new Stripe(schluessel, {
    // Wir sagen Stripe, wer anruft; das taucht in deren Protokollen auf
    // und hilft beim Nachvollziehen, wenn etwas schiefgeht.
    appInfo: { name: "Lunar Events Ticketing" },
  });
  return zwischenspeicher;
}

export function stripeEingerichtet(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );
}

/** Testschlüssel oder echtes Geld? Steht im Schlüssel selbst. */
export function stripeImTestmodus(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

/**
 * Klarna erst ab diesem Betrag anbieten (C8). Wunsch des Veranstalters:
 * Ratenkauf lohnt sich unten herum nicht, und die Gebühr frisst kleine
 * Beträge auf.
 */
export const KLARNA_AB_CENT = 5000;

/**
 * Ist die Klarna-Steuerung eingeschaltet? Der Schalter ist nötig, weil die
 * automatische Zahlartenwahl von Stripe Klarna sonst bei **jedem** Betrag
 * zeigt (die 50-€-Grenze griffe nicht) und weil Stripe die Zahlung ablehnt,
 * wenn man Klarna anfordert, ohne es freigeschaltet zu haben. Der
 * Veranstalter setzt ihn erst, wenn Klarna im Stripe-Konto wirklich aktiv
 * ist. Solange er aus ist, bleibt die automatische Wahl wie bisher.
 */
export function stripeKlarnaAktiv(): boolean {
  return process.env.STRIPE_KLARNA === "an";
}

/** Bekommt dieser Kauf Klarna? Nur mit Schalter und ab der Grenze. */
export function klarnaFuer(betragCent: number): boolean {
  return stripeKlarnaAktiv() && betragCent >= KLARNA_AB_CENT;
}

/**
 * Die eigene Adresse, absolut. Stripe braucht sie für die Rückleitung
 * nach der Zahlung, und relative Pfade akzeptiert es nicht.
 */
export function eigeneAdresse(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  // Auf Vercel steht die Adresse in der Umgebung, aber ohne Protokoll.
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
