import { useLocale, useTranslations } from "next-intl";
import { preisText } from "@/lib/format";
import css from "./Streichpreis.module.css";

/**
 * Der dezent durchgestrichene Preis neben einem Preis (0030). Sichtbar ohne
 * Beschriftung — so entschieden am 18.09.2026. Für Screenreader steht
 * „Abendkasse“ davor: Ein Vorleseprogramm sagt sonst nur zwei Beträge
 * hintereinander, und niemand wüsste, welcher gilt.
 */
export function Streichpreis({ cent }: { cent: number }) {
  const t = useTranslations("event");
  const locale = useLocale();
  return (
    <s className={css.streich}>
      <span className={css.vorlesen}>{t("streichpreisVorlesen")} </span>
      {preisText(cent, locale)}
    </s>
  );
}
