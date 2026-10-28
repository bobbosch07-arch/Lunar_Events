import { setRequestLocale } from "next-intl/server";
import { CrewApp } from "@/components/crew/CrewApp";

/**
 * Bewusst ohne Anmeldung auf dem Server: Die Seite ist für alle gleich, damit
 * der Service Worker sie zwischenspeichern und ohne Netz ausliefern kann.
 * Wer was darf, prüft die App im Browser und am Ende die Datenbank.
 */
export default async function Crew({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CrewApp />;
}
