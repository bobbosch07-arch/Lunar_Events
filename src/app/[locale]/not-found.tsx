import { useTranslations } from "next-intl";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { Knopf } from "@/components/Knopf";
import css from "./meldung.module.css";

export default function NichtGefunden() {
  const t = useTranslations("allgemein");

  return (
    <>
      <Kopfzeile />
      <main className={css.flaeche}>
        <div className={`seitenbreite ${css.mitte}`}>
          <span className={css.zahl} aria-hidden="true">
            404
          </span>
          <h1 className={css.titel}>{t("nichtGefundenTitel")}</h1>
          <p className={css.text}>{t("nichtGefundenText")}</p>
          <div className={css.knoepfe}>
            <Knopf href="/events">Alle Events</Knopf>
            <Knopf href="/" stil="linie">
              {t("zurStartseite")}
            </Knopf>
          </div>
        </div>
      </main>
      <Fusszeile />
    </>
  );
}
