import Image from "next/image";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Veranstaltung } from "@/lib/typen";
import { bildUrl } from "@/lib/bilder";
import { preisText } from "@/lib/format";
import css from "./EventKarte.module.css";

type Props = {
  event: Veranstaltung;
  /** Die ersten sichtbaren Karten laden ihr Bild bevorzugt. */
  prioritaet?: boolean;
};

export function EventKarte({ event, prioritaet = false }: Props) {
  const t = useTranslations("events");
  const f = useFormatter();
  const locale = useLocale();
  const beginn = new Date(event.beginn);

  const tag = f.dateTime(beginn, { day: "2-digit" });
  const monat = f.dateTime(beginn, { month: "short" }).replace(".", "");

  return (
    <Link href={`/events/${event.slug}`} className={css.karte}>
      <div className={css.bildfeld}>
        {event.bild ? (
          <Image
            src={bildUrl(event.bild.pfad)}
            alt={event.bild.alt ?? event.titel}
            fill
            sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
            className={css.bild}
            style={{ objectPosition: event.bild.fokus ?? "center" }}
            priority={prioritaet}
          />
        ) : null}

        <span className={css.datum}>
          <span>{tag}</span>
          <span>{monat}</span>
        </span>

        {event.ausverkauft ? (
          <span className={`${css.marke} ${css.markeAus}`}>{t("ausverkauft")}</span>
        ) : event.vip_verfuegbar ? (
          <span className={css.marke}>{t("vipFrei")}</span>
        ) : null}
      </div>

      <div className={css.text}>
        <span className={css.kategorie}>{event.kategorie}</span>
        <h3 className={css.titel}>{event.titel}</h3>
        <p className={css.ort}>
          {event.ort.stadt} · {event.ort.name}
        </p>

        <div className={css.fuss}>
          {event.ausverkauft || event.ab_preis_cent === null ? (
            <span className={css.preisAus}>{t("ausverkauft")}</span>
          ) : (
            <span className={css.preis}>
              {t("abPreis", {
                preis: preisText(event.ab_preis_cent, locale),
              })}
            </span>
          )}
          <span className={css.cta}>{t("ansehen")}</span>
        </div>
      </div>
    </Link>
  );
}
