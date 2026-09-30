"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Logo } from "./Logo";
import { Stern } from "./Deko";
import { browserClient } from "@/lib/supabase/client";
import css from "./Kopfzeile.module.css";

type Props = {
  /**
   * Auf Seiten mit Hero schwebt der Kopf durchscheinend darauf und wird
   * erst beim Scrollen dichter.
   */
  ueberHero?: boolean;
  /**
   * Wohin "Tickets" führt. Die Startseite gibt das nächste Event mit,
   * die Eventseite ihre eigene Ticketauswahl; sonst die Eventliste.
   */
  ticketZiel?: string;
};

const ZIELE = [
  { href: "/events", schluessel: "events" },
  { href: "/about", schluessel: "about" },
  { href: "/kontakt", schluessel: "kontakt" },
] as const;

export function Kopfzeile({ ueberHero = false, ticketZiel = "/events" }: Props) {
  const t = useTranslations("nav");
  const pfad = usePathname();
  const locale = useLocale();
  const [offen, setOffen] = useState(false);
  const [gescrollt, setGescrollt] = useState(false);
  const [team, setTeam] = useState(false);
  const kopfRef = useRef<HTMLElement>(null);

  // Gehört die angemeldete Person zum Team, steht "Backoffice" neben
  // "Account". Geprüft wird im Browser und nicht auf dem Server: Der Kopf
  // hängt auch an statisch vorgerenderten Seiten, und eine Serverprüfung
  // machte jede davon dynamisch. Die Verknüpfung ist nur ein Wegweiser —
  // was dahinter sichtbar ist, entscheidet weiterhin das Backoffice selbst.
  useEffect(() => {
    let aktiv = true;
    const db = browserClient();
    db.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id;
      if (!id) return;
      const { data: m } = await db
        .from("mitarbeiter")
        .select("rolle, aktiv")
        .eq("user_id", id)
        .maybeSingle();
      if (aktiv) setTeam(Boolean(m?.aktiv && (m.rolle === "admin" || m.rolle === "team")));
    });
    return () => {
      aktiv = false;
    };
  }, []);

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

  // Ein Tipp neben das Menü oder Escape schließt es. Der Link zur Seite, auf
  // der man schon ist, schließt es auch (onClick unten): Ohne Seitenwechsel
  // griffe der Effekt darüber nicht, und das Menü bliebe einfach stehen.
  useEffect(() => {
    if (!offen) return;
    const tipp = (e: PointerEvent) => {
      if (kopfRef.current && !kopfRef.current.contains(e.target as Node)) setOffen(false);
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOffen(false);
    };
    document.addEventListener("pointerdown", tipp);
    document.addEventListener("keydown", taste);
    return () => {
      document.removeEventListener("pointerdown", tipp);
      document.removeEventListener("keydown", taste);
    };
  }, [offen]);

  useEffect(() => {
    document.body.style.overflow = offen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [offen]);

  // Offen und nach dem Scrollen wird der Kasten dicht: Das Menü hat keinen
  // eigenen Grund, und darunter läuft der Inhalt durch.
  const dicht = gescrollt || offen || !ueberHero;
  const klassen = [css.kopf, dicht ? css.dicht : null].filter(Boolean).join(" ");

  return (
    <header ref={kopfRef} className={klassen}>
      <div className={css.kasten}>
        <div className={css.reihe}>
          <Link href="/" className={css.markeLink} aria-label="Lunar Events">
            <Logo ton="ivory" hoehe={56} prioritaet />
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
            {/* Der Weg zu den eigenen Tickets bleibt immer sichtbar
                (Briefing 20) — auf dem Handy als Symbol, sonst passt
                der Kasten nicht in 360 px. */}
            <Link href="/konto/tickets" className={`${css.punkt} ${css.ticketPunkt}`}>
              <svg className={css.ticketSymbol} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4Z" />
                <path d="M14 7v10" strokeDasharray="2 2" />
              </svg>
              <span className={css.ticketText}>{t("meineTickets")}</span>
            </Link>
            {team ? (
              <Link href="/backoffice" className={css.punkt}>
                {t("backoffice")}
              </Link>
            ) : null}
            <Link href="/konto" className={css.punkt}>
              {t("konto")}
            </Link>
            <span className={css.sprachWahl}>
              {routing.locales.map((l) => (
                <Link
                  key={l}
                  href={pfad}
                  locale={l}
                  className={l === locale ? css.spracheAn : undefined}
                  aria-current={l === locale ? "true" : undefined}
                >
                  {l.toUpperCase()}
                </Link>
              ))}
            </span>
            <Link href={ticketZiel} className={css.ticketsKnopf}>
              <Stern className={css.knopfStern} />
              {t("tickets")}
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
            <Link
              key={z.href}
              href={z.href}
              className={css.schubladePunkt}
              onClick={() => setOffen(false)}
            >
              {t(z.schluessel)}
            </Link>
          ))}
          <span className={css.schubladeTrenner} />
          <Link href="/konto/tickets" className={css.schubladePunkt} onClick={() => setOffen(false)}>
            {t("meineTickets")}
          </Link>
          <Link href="/konto" className={css.schubladePunkt} onClick={() => setOffen(false)}>
            {t("konto")}
          </Link>
          {team ? (
            <Link href="/backoffice" className={css.schubladePunkt} onClick={() => setOffen(false)}>
              {t("backoffice")}
            </Link>
          ) : null}
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
