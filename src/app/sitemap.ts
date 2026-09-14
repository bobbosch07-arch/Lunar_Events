import type { MetadataRoute } from "next";
import { holeKommendeEvents } from "@/lib/events";
import { eigeneAdresse } from "@/lib/stripe";
import { routing } from "@/i18n/routing";

/**
 * Deutsch läuft ohne Präfix, Englisch unter /en — beide gehören in die
 * Karte, damit Suchmaschinen die Sprachen als Varianten derselben Seite
 * erkennen und nicht als Dubletten.
 */
function mitSprachen(pfad: string) {
  const basis = eigeneAdresse();
  const sprachen: Record<string, string> = {};
  for (const locale of routing.locales) {
    sprachen[locale] =
      locale === routing.defaultLocale ? `${basis}${pfad}` : `${basis}/${locale}${pfad}`;
  }
  return { url: `${basis}${pfad}`, alternates: { languages: sprachen } };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const feste = ["", "/events", "/vip", "/about", "/kontakt", "/faq"].map((pfad) => ({
    ...mitSprachen(pfad),
    lastModified: new Date(),
    changeFrequency: (pfad === "" || pfad === "/events" ? "daily" : "monthly") as
      | "daily"
      | "monthly",
    priority: pfad === "" ? 1 : pfad === "/events" ? 0.9 : 0.5,
  }));

  // Das Impressum steht absichtlich nicht in der Sitemap (noindex, siehe dort).
  const rechtliches = ["/agb", "/datenschutz"].map((pfad) => ({
    ...mitSprachen(pfad),
    lastModified: new Date(),
    changeFrequency: "yearly" as const,
    priority: 0.2,
  }));

  let events: MetadataRoute.Sitemap = [];
  try {
    const alle = await holeKommendeEvents();
    events = alle.map((e) => ({
      ...mitSprachen(`/events/${e.slug}`),
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));
  } catch {
    // Ohne Datenbank bleibt die Karte bei den festen Seiten — eine
    // unvollständige Karte ist besser als gar keine.
  }

  return [...feste, ...events, ...rechtliches];
}
