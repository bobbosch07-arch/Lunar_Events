import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { holeAngemeldeten } from "@/lib/konto";
import { CrewPasswort } from "@/components/crew/CrewPasswort";

export const metadata: Metadata = { title: "Crew-Passwort", robots: { index: false, follow: false } };

/**
 * Hierher führt der Link aus „Noch kein Passwort?“ in der Crew-App. Er öffnet
 * sich in Safari, nicht in der Home-Bildschirm-App — deshalb wird hier nur
 * das Passwort festgelegt, angemeldet wird danach in der App.
 */
export default async function CrewPasswortSeite({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const angemeldet = await holeAngemeldeten();
  return <CrewPasswort email={angemeldet?.email ?? null} />;
}
