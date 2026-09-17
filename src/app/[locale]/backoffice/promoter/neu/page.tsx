import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { PromoterFormular } from "@/components/PromoterFormular";
import { darfCodesAendern } from "@/lib/backoffice";
import { LEERER_PROMOTER } from "@/lib/promoter";

export const metadata: Metadata = {
  title: "Promoter anlegen",
  robots: { index: false, follow: false },
};

export default async function NeuerPromoter({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Promoter anlegen" />
      <Suspense fallback={<BackofficeSkelett zeilen={4} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  // Dieselbe Rolle wie bei den Codes: ändern dürfen Admins.
  const darf = await darfCodesAendern();
  return (
    <PromoterFormular start={LEERER_PROMOTER} darfAendern={darf} statistikLink={null} links={[]} />
  );
}
