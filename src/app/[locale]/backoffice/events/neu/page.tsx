import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { EventFormular } from "@/components/EventFormular";
import { LEERE_PHASE, type EventStand } from "@/lib/event-stand";
import { holeOrte } from "@/app/aktionen/event-speichern";

export const metadata: Metadata = {
  title: "Event anlegen",
  robots: { index: false, follow: false },
};

/** Startwerte, die zu den meisten Nächten passen — änderbar, aber kein leeres Blatt. */
function vorlage(): EventStand {
  const in30Tagen = new Date();
  in30Tagen.setDate(in30Tagen.getDate() + 30);
  const tag = in30Tagen.toISOString().slice(0, 10);

  return {
    slug: "",
    titel: "",
    untertitel: "",
    teaser: "",
    beschreibung: "",
    kategorie: "club",
    status: "entwurf",
    beginn: `${tag}T23:00`,
    einlass: `${tag}T22:00`,
    ende: "",
    ortId: "",
    bildPfad: "",
    bildAlt: "",
    bildFokus: "center",
    mindestalter: "21",
    dresscode: "",
    abendkasse: false,
    abendkasseHinweis: "",
    streichpreisEuro: "",
    featured: false,
    fastlaneAktiv: false,
    fastlanePreisEuro: "10,00",
    fastlaneKontingent: "50",
    fastlaneBeschreibung: "",
    fastlaneVerkauft: 0,
    garderobeAktiv: false,
    garderobePreisEuro: "3,00",
    garderobeKontingent: "",
    garderobeVerkauft: 0,
    presaleAb: "",
    verkaufAb: "",
    phasen: [
      { ...LEERE_PHASE, name: "Early Bird", preisEuro: "29,00", kontingent: "100" },
      { ...LEERE_PHASE, name: "Standard", preisEuro: "39,00" },
      {
        ...LEERE_PHASE,
        name: "VIP Experience",
        art: "vip",
        kontingent: "6",
        beschreibung: "Für vier bis zwölf Gäste.",
        leistungen: [
          "Eigener Tisch mit reservierter Fläche",
          "Bottle Service am Platz",
          "Priority Entry ohne Anstehen",
        ],
      },
    ],
  };
}

export default async function NeuesEvent({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Event anlegen" />
      <Suspense fallback={<BackofficeSkelett zeilen={8} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const orte = await holeOrte();
  return <EventFormular start={vorlage()} orte={orte} />;
}
