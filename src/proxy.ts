import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Alles ausser Next-Interna, API-Routen und Dateien mit Endung.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
