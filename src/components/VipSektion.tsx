import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { Stern, akzent } from "./Deko";
import css from "./VipSektion.module.css";

type Props = {
  /** Aus dem Eventdetail heraus ist die Anfrage schon auf das Event bezogen. */
  eventSlug?: string;
};

const LEISTUNGEN = ["tisch", "service", "einlass", "absprache"] as const;

/**
 * VIP als mondgelbe Fläche. Die Leistungen tragen Sterne statt Nummern:
 * Sie sind keine Reihenfolge, nur eine Aufzählung.
 */
export function VipSektion({ eventSlug }: Props) {
  const t = useTranslations("vip");
  const ziel = eventSlug ? `/vip?event=${eventSlug}` : "/vip";

  return (
    <div className={css.block} data-grund="gelb">
      <div className={css.links}>
        <span className="eyebrow">
          <Stern className={css.eyebrowStern} />
          {t("eyebrow")}
        </span>
        <h2 className={css.titel}>{t.rich("titel", { akzent })}</h2>
        <p className={css.text}>{t("text")}</p>
        <span className={css.knopf}>
          <Knopf href={ziel}>{t("cta")}</Knopf>
        </span>
      </div>

      <ul className={css.liste}>
        {LEISTUNGEN.map((schluessel) => (
          <li key={schluessel} className={css.punkt}>
            <Stern className={css.stern} />
            <span>{t(`leistungen.${schluessel}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
