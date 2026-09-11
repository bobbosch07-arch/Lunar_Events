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
