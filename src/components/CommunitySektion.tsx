import { getTranslations } from "next-intl/server";
import css from "./CommunitySektion.module.css";

const INSTAGRAM =
  "https://www.instagram.com/lunar_events.de?stkn=b3NxM2xjYTFtZ21i&utm_source=qr";
const WHATSAPP =
  "https://chat.whatsapp.com/KJGl6e2ag8t1cwdSMUh2Xf?s=sw&p=i&mlu=4&ilr=4";

/**
 * Prominenter Aufruf, Instagram zu folgen und der WhatsApp-Community
 * beizutreten. Dunkler Grund, Gold als Akzent — beides über die
 * semantischen Tokens (`data-grund="dunkel"`), keine Markenfarben, damit
 * es zur Seite passt. Die Icons machen die Plattform trotzdem sofort klar.
 */
export async function CommunitySektion() {
  const t = await getTranslations("start");

  return (
    <section className="abschnitt" data-grund="dunkel">
      <div className="seitenbreite">
        <div className={css.block}>
          <div className={css.text}>
            <span className="eyebrow">{t("communityEyebrow")}</span>
            <h2 className={css.titel}>{t("communityTitel")}</h2>
            <p className={css.unterzeile}>{t("communityText")}</p>
          </div>

          <div className={css.knoepfe}>
            <a
              href={INSTAGRAM}
              className={`${css.knopf} ${css.instagram}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <svg
                className={css.icon}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
              <span>{t("communityInsta")}</span>
            </a>

            <a
              href={WHATSAPP}
              className={`${css.knopf} ${css.whatsapp}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <svg
                className={css.icon}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.5-4.7A7.5 7.5 0 1 1 20 11.5Z" />
                <path
                  d="M9 8.6c.2-.5.4-.5.7-.5h.5c.2 0 .4 0 .6.5l.6 1.4c.1.2 0 .4-.1.5l-.4.5c-.1.2-.2.3 0 .6.3.5.7.9 1.2 1.2.3.2.5.2.7 0l.4-.5c.2-.2.3-.2.5-.1l1.3.6c.2.1.4.3.4.5s0 .8-.3 1.1c-.3.4-.9.8-1.5.8-1.4 0-3-.9-4-2-.9-1-1.6-2.2-1.6-3.2 0-.6.3-1.1.5-1.4Z"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
              <span>{t("communityWhatsapp")}</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
