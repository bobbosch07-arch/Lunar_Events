import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Logo } from "./Logo";
import { Newsletter } from "./Newsletter";
import css from "./Fusszeile.module.css";

const INSTAGRAM = "https://instagram.com/lunar.events";

export function Fusszeile() {
  const t = useTranslations("footer");
  const tn = useTranslations("nav");
  const jahr = new Date().getFullYear();

  return (
    <footer className={css.fuss} data-grund="tief">
      <div className="seitenbreite">
        <div className={css.oben}>
          <div className={css.marke}>
            <Logo ton="ivory" hoehe={38} />
            <p className={css.markeSatz}>
              Ausgewählte Nächte in Frankfurt, Mannheim und Stuttgart.
            </p>
            <Newsletter />
          </div>

          <div className={css.spalten}>
            <ul className={css.spalte}>
              <li className={css.spaltenTitel}>Lunar</li>
              <li>
                <Link href="/events" className={css.punkt}>
                  {t("events")}
                </Link>
              </li>
              <li>
                <Link href="/about" className={css.punkt}>
                  {t("about")}
                </Link>
              </li>
              <li>
                <Link href="/kontakt" className={css.punkt}>
                  {t("kontakt")}
                </Link>
              </li>
              <li>
                <Link href="/faq" className={css.punkt}>
                  {t("faq")}
                </Link>
              </li>
            </ul>

            <ul className={css.spalte}>
              <li className={css.spaltenTitel}>{tn("konto")}</li>
              <li>
                <Link href="/konto/tickets" className={css.punkt}>
                  {tn("meineTickets")}
                </Link>
              </li>
              <li>
                <Link href="/konto" className={css.punkt}>
                  {tn("konto")}
                </Link>
              </li>
            </ul>

            <ul className={css.spalte}>
              <li className={css.spaltenTitel}>Legal</li>
              <li>
                <Link href="/agb" className={css.punkt}>
                  {t("agb")}
                </Link>
              </li>
              <li>
                <Link href="/datenschutz" className={css.punkt}>
                  {t("datenschutz")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className={css.unten}>
          <span>
            {t("rechte", { jahr })}
            {/* Das Impressum steht bewusst nur hier, klein neben dem
                Copyright: gesetzlich muss es von jeder Seite erreichbar
                sein, auffallen muss es nicht. */}
            <Link href="/impressum" className={css.impressum}>
              {t("impressum")}
            </Link>
          </span>
          <div className={css.sozial}>
            <a
              href={INSTAGRAM}
              className={css.sozialPunkt}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Instagram"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
