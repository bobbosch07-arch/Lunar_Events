import { defineRouting } from "next-intl/routing";

/**
 * Deutsch ist die Voreinstellung und laeuft ohne Praefix (/events),
 * Englisch haengt unter /en/events. So bleiben die deutschen Adressen
 * kurz und teilbar — sie sind die, die tatsaechlich herumgereicht werden.
 */
export const routing = defineRouting({
  locales: ["de", "en"],
  defaultLocale: "de",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
