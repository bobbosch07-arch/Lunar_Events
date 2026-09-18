import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";
import type { GarderobeZustand } from "@/lib/typen";
import css from "./GarderobenMarke.module.css";

export type MarkeAnzeige = {
  code: string;
  zustand: GarderobeZustand;
  /** Bügelnummer, sobald abgegeben. */
  nummer: string | null;
};

/**
 * Eine Garderobenmarke (0027): QR-Code statt Papiermarke. Kleiner als ein
 * Ticket und ohne Eventdaten — sie steht immer unter den Tickets, zu denen
 * sie gehört. Der QR wird wie beim Ticket auf dem Server gezeichnet.
 */
export async function GarderobenMarke({
  marke,
  nr,
  gesamt,
}: {
  marke: MarkeAnzeige;
  nr: number;
  gesamt: number;
}) {
  const t = await getTranslations("garderobe");
  const svg = await QRCode.toString(marke.code, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#07111f", light: "#0000" },
  });
  const erledigt = marke.zustand === "abgeholt" || marke.zustand === "storniert";

  return (
    <article className={`${css.marke} ${erledigt ? css.erledigt : ""}`} data-grund="dunkel">
      <div
        className={css.code}
        // Das SVG stammt aus der QR-Bibliothek, nicht aus einer Eingabe.
        dangerouslySetInnerHTML={{ __html: svg }}
        role="img"
        aria-label={t("markeCode", { code: marke.code })}
      />
      <div className={css.text}>
        <span className={css.titel}>{t("titel")}</span>
        <span className={css.stueck}>{t("markeStueck", { nr, gesamt })}</span>
        <span className={`${css.zustand} ${marke.zustand === "haengt" ? css.haengt : ""}`}>
          {marke.zustand === "haengt" && marke.nummer
            ? t("markeHaengt", { nummer: marke.nummer })
            : marke.zustand === "abgeholt"
              ? t("markeAbgeholt")
              : marke.zustand === "storniert"
                ? t("markeStorniert")
                : t("markeHinweis")}
        </span>
        <span className={css.nummer}>{marke.code}</span>
      </div>
    </article>
  );
}
