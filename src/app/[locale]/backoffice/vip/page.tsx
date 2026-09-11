import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { BackofficeRahmen } from "@/components/BackofficeRahmen";
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
    <BackofficeRahmen aktiv="/backoffice/vip" titel="VIP-Anfragen">
      <Inhalt />
    </BackofficeRahmen>
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
        anfragen={anfragen}
        formatiere={(iso) => f.dateTime(new Date(iso), "kurz")}
      />

      <p className={css.notiz}>
        Solange kein Mailversand eingerichtet ist, kommt keine Benachrichtigung
        über neue Anfragen — diese Seite ist die einzige Stelle, an der sie
        auftauchen. Ein Blick pro Tag genügt, aber er muss stattfinden.
      </p>
    </>
  );
}
