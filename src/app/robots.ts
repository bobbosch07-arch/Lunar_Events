import type { MetadataRoute } from "next";
import { eigeneAdresse } from "@/lib/stripe";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Nichts davon gehört in einen Suchindex: Kasse und Konto sind
      // persönlich, der Einlass ist Werkzeug, api liefert kein Lesbares.
      disallow: ["/checkout", "/konto", "/einlass", "/garderobe", "/api/", "/auth/"],
    },
    sitemap: `${eigeneAdresse()}/sitemap.xml`,
  };
}
