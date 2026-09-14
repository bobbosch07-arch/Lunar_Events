import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { VipTabelle } from "@/components/VipTabelle";
import { holeVipAnfragen } from "@/lib/backoffice";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "VIP-Anfragen",
  robots: { index: false, follow: false },
};

export default async function VipBackoffice({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="VIP-Anfragen" />
      <Suspense fallback={<BackofficeSkelett zeilen={6} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const [anfragen, f] = await Promise.all([holeVipAnfragen(), getFormatter()]);
  const offen = anfragen.filter((a) => a.status === "neu").length;

  return (
    <>
      {offen > 0 ? (
        <p className={css.notiz} style={{ marginTop: 0, marginBottom: "1.5rem" }}>
          <strong>{offen}</strong> {offen === 1 ? "Anfrage wartet" : "Anfragen warten"} auf
          Antwort. Im Formular steht „innerhalb von 24 Stunden" — das ist eine
          Zusage.
        </p>
      ) : null}

      <VipTabelle
        anfragen={anfragen.map((a) => ({
          ...a,
          erstelltAmText: f.dateTime(new Date(a.erstelltAm), "kurz"),
        }))}
      />

      <p className={css.notiz}>
        Solange kein Mailversand eingerichtet ist, kommt keine Benachrichtigung
        über neue Anfragen — diese Seite ist die einzige Stelle, an der sie
        auftauchen. Ein Blick pro Tag genügt, aber er muss stattfinden.
      </p>
    </>
  );
}
