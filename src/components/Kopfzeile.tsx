"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { Logo } from "./Logo";
import { browserClient } from "@/lib/supabase/client";
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

  // Offen trägt der Kopf immer die helle Fläche, auch über dem Hero: Das
  // Menü hat keinen eigenen Grund, und helle Schrift läge sonst auf Ivory.
  const hell = gescrollt || offen;
  const dunkelOben = ueberHero && !hell;
  const klassen = [
    css.kopf,
    ueberHero ? css.ueberHero : css.fest,
    hell ? css.gescrollt : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header
      ref={kopfRef}
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
            {team ? (
              <Link href="/backoffice" className={css.punkt}>
                {t("backoffice")}
              </Link>
            ) : null}
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
