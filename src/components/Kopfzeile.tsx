"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Logo } from "./Logo";
import css from "./Kopfzeile.module.css";

type Props = {
  /**
   * Auf Seiten mit dunklem Hero liegt der Kopf zunaechst durchsichtig darauf
   * und wird erst beim Scrollen zu einer Flaeche.
   */
  ueberHero?: boolean;
};

const ZIELE = [
  { href: "/events", schluessel: "events" },
  { href: "/about", schluessel: "about" },
  { href: "/kontakt", schluessel: "kontakt" },
] as const;

export function Kopfzeile({ ueberHero = false }: Props) {
  const t = useTranslations("nav");
  const pfad = usePathname();
  const locale = useLocale();
  const [offen, setOffen] = useState(false);
  const [gescrollt, setGescrollt] = useState(false);

  useEffect(() => {
    if (!ueberHero) return;
    const pruefe = () => setGescrollt(window.scrollY > 40);
    pruefe();
    window.addEventListener("scroll", pruefe, { passive: true });
    return () => window.removeEventListener("scroll", pruefe);
  }, [ueberHero]);

  // Beim Seitenwechsel schliesst das Menue — sonst bleibt es ueber der
  // neuen Seite stehen.
  useEffect(() => {
    setOffen(false);
  }, [pfad]);

  useEffect(() => {
    document.body.style.overflow = offen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [offen]);

  const dunkelOben = ueberHero && !gescrollt;
  const klassen = [
    css.kopf,
    ueberHero ? css.ueberHero : css.fest,
    gescrollt ? css.gescrollt : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header
      className={klassen}
      data-grund={dunkelOben ? "tief" : undefined}
    >
      <div className="seitenbreite">
        <div className={css.reihe}>
          <Link href="/" className={css.markeLink} aria-label="Lunar Events">
            <Logo ton={dunkelOben ? "ivory" : "navy"} hoehe={50} prioritaet />
          </Link>

          <nav className={css.mitte} aria-label={t("events")}>
            {ZIELE.map((z) => (
              <Link
                key={z.href}
                href={z.href}
                className={`${css.punkt} ${pfad.startsWith(z.href) ? css.aktiv : ""}`}
              >
                {t(z.schluessel)}
              </Link>
            ))}
          </nav>

          <div className={css.rechts}>
            <Link
              href="/konto/tickets"
              className={`${css.punkt} ${css.ticketPunkt}`}
            >
              {t("meineTickets")}
            </Link>
            <Link href="/konto" className={css.punkt}>
              {t("konto")}
            </Link>
            <button
              type="button"
              className={`${css.menuKnopf} ${offen ? css.offen : ""}`}
              aria-expanded={offen}
              aria-controls="hauptmenue"
              aria-label={offen ? t("menuSchliessen") : t("menuOeffnen")}
              onClick={() => setOffen((o) => !o)}
            >
              <span className={css.balken1} />
              <span className={css.balken2} />
              <span className={css.balken3} />
            </button>
          </div>
        </div>

        <nav
          id="hauptmenue"
          className={`${css.schublade} ${offen ? css.schubladeOffen : ""}`}
          hidden={!offen}
        >
          {ZIELE.map((z) => (
            <Link key={z.href} href={z.href} className={css.schubladePunkt}>
              {t(z.schluessel)}
            </Link>
          ))}
          <span className={css.schubladeTrenner} />
          <Link href="/konto/tickets" className={css.schubladePunkt}>
            {t("meineTickets")}
          </Link>
          <Link href="/konto" className={css.schubladePunkt}>
            {t("konto")}
          </Link>
          <span className={css.schubladeTrenner} />
          <div className={css.sprachen}>
            <span>{t("sprache")}</span>
            {routing.locales.map((l) => (
              <Link
                key={l}
                href={pfad}
                locale={l}
                className={l === locale ? css.spracheAktiv : undefined}
              >
                {l.toUpperCase()}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
