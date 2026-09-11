import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import css from "./VipSektion.module.css";

type Props = {
  /** Aus dem Eventdetail heraus ist die Anfrage schon auf das Event bezogen. */
  eventSlug?: string;
};

const LEISTUNGEN = ["tisch", "service", "einlass", "absprache"] as const;

export function VipSektion({ eventSlug }: Props) {
  const t = useTranslations("vip");
  const ziel = eventSlug ? `/vip?event=${eventSlug}` : "/vip";

  return (
    <div className={css.block} data-grund="tief">
      <div className={css.links}>
        <span className="eyebrow">{t("eyebrow")}</span>
        <h2 className={css.titel}>{t("titel")}</h2>
        <p className={css.text}>{t("text")}</p>
        <span className={css.knopf}>
          <Knopf href={ziel} stil="gold">
            {t("cta")}
          </Knopf>
        </span>
      </div>

      <ul className={css.liste}>
        {LEISTUNGEN.map((schluessel, i) => (
          <li key={schluessel} className={css.punkt}>
            <span className={css.nummer}>{String(i + 1).padStart(2, "0")}</span>
            <span>{t(`leistungen.${schluessel}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
