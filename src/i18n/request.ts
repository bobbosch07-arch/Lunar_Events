import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const angefragt = await requestLocale;
  const locale = hasLocale(routing.locales, angefragt)
    ? angefragt
    : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: "Europe/Berlin",
    formats: {
      dateTime: {
        kurz: { day: "2-digit", month: "short" },
        lang: { day: "2-digit", month: "long", year: "numeric" },
        mitZeit: {
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
      },
      number: {
        preis: { style: "currency", currency: "EUR" },
      },
    },
  };
});
