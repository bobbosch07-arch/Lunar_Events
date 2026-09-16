import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { RabattcodeFormular } from "@/components/RabattcodeFormular";
import { darfCodesAendern, holeEventWahl } from "@/lib/backoffice";
import { LEERER_CODE } from "@/lib/rabatt";
import { eigeneAdresse } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Rabattcode anlegen",
  robots: { index: false, follow: false },
};

export default async function NeuerRabattcode({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Rabattcode anlegen" />
      <Suspense fallback={<BackofficeSkelett zeilen={8} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const [events, darf] = await Promise.all([holeEventWahl(), darfCodesAendern()]);
  return (
    <RabattcodeFormular
      start={LEERER_CODE}
      events={events}
      darfAendern={darf}
      eingeloest={0}
      adresse={eigeneAdresse()}
    />
  );
}
