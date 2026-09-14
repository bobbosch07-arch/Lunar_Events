import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Hochrechnung } from "@/components/Hochrechnung";
import { holeHochrechnung } from "@/lib/backoffice";

export const metadata: Metadata = {
  title: "Hochrechnung",
  robots: { index: false, follow: false },
};

export default async function HochrechnungSeite({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Hochrechnung" />
      <Suspense fallback={<BackofficeSkelett kacheln={4} zeilen={5} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const events = await holeHochrechnung();
  return <Hochrechnung events={events} />;
}
