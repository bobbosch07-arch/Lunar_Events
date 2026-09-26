import { getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { EventKarte } from "@/components/EventKarte";
import { VipSektion } from "@/components/VipSektion";
import { Knopf } from "@/components/Knopf";
import { Logo } from "@/components/Logo";
import { holeFeaturedEvents, holeKommendeEvents } from "@/lib/events";
import css from "./start.module.css";

export default async function Startseite({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("start");
  const [featured, kommend] = await Promise.all([
    holeFeaturedEvents(),
    holeKommendeEvents(),
  ]);

  // Was oben schon gross zu sehen ist, muss unten nicht noch einmal stehen.
  const uebrig = kommend.filter((e) => !featured.some((f) => f.id === e.id));

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile ueberHero />

      <main id="inhalt">
        <section className={css.hero} data-grund="tief">
          <div className={css.heroGrund} aria-hidden="true" />
          <div className={css.heroSchleier} aria-hidden="true" />
          <div className={`seitenbreite ${css.heroInhalt}`}>
            <div className={css.heroLogo}>
              <Logo ton="ivory" hoehe={128} prioritaet />
            </div>
            <h1 className={css.heroTitel}>{t("heroTitel")}</h1>
            <p className={css.heroText}>{t("heroText")}</p>
            <div className={css.heroKnoepfe}>
              <Knopf href="/events" stil="hell" groesse="gross">
                {t("heroCta")}
              </Knopf>
              <Knopf href="/about" stil="linieHell" groesse="gross">
                {t("heroCtaZwei")}
              </Knopf>
            </div>

            <div className={css.heroSozial}>
              <a
                href="https://www.instagram.com/lunar_events.de"
                className={css.sozialKnopf}
                target="_blank"
                rel="noreferrer noopener"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
                </svg>
                <span>{t("sozialInsta")}</span>
              </a>
              <a
                href="https://chat.whatsapp.com/KJGl6e2ag8t1cwdSMUh2Xf?s=sw&p=i&mlu=4&ilr=4"
                className={css.sozialKnopf}
                target="_blank"
                rel="noreferrer noopener"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.5-4.7A7.5 7.5 0 1 1 20 11.5Z" />
                  <path d="M9 8.6c.2-.5.4-.5.7-.5h.5c.2 0 .4 0 .6.5l.6 1.4c.1.2 0 .4-.1.5l-.4.5c-.1.2-.2.3 0 .6.3.5.7.9 1.2 1.2.3.2.5.2.7 0l.4-.5c.2-.2.3-.2.5-.1l1.3.6c.2.1.4.3.4.5s0 .8-.3 1.1c-.3.4-.9.8-1.5.8-1.4 0-3-.9-4-2-.9-1-1.6-2.2-1.6-3.2 0-.6.3-1.1.5-1.4Z" fill="currentColor" stroke="none" />
                </svg>
                <span>{t("sozialWhatsapp")}</span>
              </a>
            </div>
          </div>
        </section>

        {featured.length > 0 ? (
          <section className="abschnitt">
            <div className="seitenbreite">
              <div className={css.kopfzeile}>
                <div className={css.kopfLinks}>
                  <span className="eyebrow">{t("featuredEyebrow")}</span>
                  <h2>{t("featuredTitel")}</h2>
                </div>
              </div>
              <div className={css.raster}>
                {featured.map((e, i) => (
                  <EventKarte key={e.id} event={e} prioritaet={i < 2} />
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {/* Stehen alle kommenden Events schon oben, bleibt der Kalender weg.
            Sonst stünde direkt unter "Die nächsten Nächte" der Satz, dass
            keine Events angekündigt sind. */}
        {uebrig.length > 0 || featured.length === 0 ? (
          <section className="abschnitt" data-grund="gedaempft">
            <div className="seitenbreite">
              <div className={css.kopfzeile}>
                <div className={css.kopfLinks}>
                  <span className="eyebrow">{t("kommendEyebrow")}</span>
                  <h2>{t("kommendTitel")}</h2>
                </div>
                <Knopf href="/events" stil="linie" groesse="klein">
                  {t("alleEvents")}
                </Knopf>
              </div>

              {uebrig.length > 0 ? (
                <div className={css.raster}>
                  {uebrig.map((e) => (
                    <EventKarte key={e.id} event={e} />
                  ))}
                </div>
              ) : (
                <p className={css.leer}>{t("kommendLeer")}</p>
              )}
            </div>
          </section>
        ) : null}

        <section className="abschnitt">
          <div className="seitenbreite">
            <VipSektion />
          </div>
        </section>

        <section className="abschnitt" data-grund="gedaempft">
          <div className="seitenbreite">
            <div className={css.marke}>
              <div className={css.markeSpalte}>
                <span className="eyebrow">{t("markeEyebrow")}</span>
                <h2 className={css.markeTitel}>{t("markeTitel")}</h2>
              </div>
              <div className={css.markeSpalte}>
                <p className={css.markeText}>{t("markeText")}</p>
                <Knopf href="/about" stil="linie">
                  {t("heroCtaZwei")}
                </Knopf>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Fusszeile />
    </>
  );
}
