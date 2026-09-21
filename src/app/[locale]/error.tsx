"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Knopf } from "@/components/Knopf";
import css from "./meldung.module.css";

/**
 * Was der Gast sieht, wenn etwas unerwartet schiefgeht. Absichtlich ohne
 * Kopf- und Fußzeile: die könnten dieselbe Störung ausgelöst haben.
 */
export default function Fehler({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("allgemein");

  useEffect(() => {
    console.error("[seite] unerwarteter Fehler:", error);
  }, [error]);

  return (
    <main className={css.flaeche}>
      <div className={`seitenbreite ${css.mitte}`}>
        <span className="eyebrow">{t("stoerung")}</span>
        <h1 className={css.titel}>{t("fehlerTitel")}</h1>
        <p className={css.text}>{t("fehlerText")}</p>
        <div className={css.knoepfe}>
          <Knopf onClick={reset}>{t("nochmal")}</Knopf>
          <Knopf href="/" stil="linie">
            {t("zurStartseite")}
          </Knopf>
        </div>
        {error.digest ? (
          <p className={css.kennung}>
            {t("kennungSupport")} <strong>{error.digest}</strong>
          </p>
        ) : null}
      </div>
    </main>
  );
}
