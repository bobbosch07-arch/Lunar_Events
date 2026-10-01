import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { EventKarte } from "@/components/EventKarte";
import { VipSektion } from "@/components/VipSektion";
import { Knopf } from "@/components/Knopf";
import { Laufband } from "@/components/Laufband";
import { Kosmos, Stern, akzent } from "@/components/Deko";
import { holeFeaturedEvents, holeKommendeEvents } from "@/lib/events";
import { verkaufsHinweis } from "@/lib/typen";
import css from "./start.module.css";

export default async function Startseite({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("start");
  const tl = await getTranslations("laufband");
  const f = await getFormatter();
  const [featured, kommend] = await Promise.all([
    holeFeaturedEvents(),
    holeKommendeEvents(),
  ]);

  // Was oben schon gross zu sehen ist, muss unten nicht noch einmal stehen.
  const uebrig = kommend.filter((e) => !featured.some((x) => x.id === e.id));

  // "Tickets sichern" führt zur Ticketauswahl des nächsten Events, das noch
  // Tickets hat (Wunsch 30.09.2026). Ohne kommendes Event zur Eventliste.
  const naechstes = kommend.find((e) => !e.ausverkauft) ?? kommend[0] ?? null;
  const ticketZiel = naechstes ? `/events/${naechstes.slug}#tickets` : "/events";
  const hinweis = naechstes ? verkaufsHinweis(naechstes) : null;
  const sticker =
    hinweis === "presale"
      ? [tl("stickerPresaleOben"), tl("stickerPresaleUnten")]
      : hinweis === "online"
        ? [tl("stickerOnlineOben"), tl("stickerOnlineUnten")]
        : hinweis === "ausverkauft"
          ? [tl("stickerAusOben"), tl("stickerAusUnten")]
          : null;

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Laufband events={kommend} />
      <Kopfzeile ueberHero ticketZiel={ticketZiel} />

      <main id="inhalt">
        <section className={css.hero}>
          <span className={css.geist} aria-hidden="true">
            After dark
          </span>
          <span className={`sichel ${css.heroSichel}`} aria-hidden="true" />
          <Stern className={`${css.stern} ${css.stern1}`} />
          <Stern className={`${css.stern} ${css.stern2}`} />
          <Stern className={`${css.stern} ${css.stern3}`} />

          <div className={`seitenbreite ${css.heroInhalt}`}>
            <p className={`eyebrow ${css.heroEyebrow}`}>
              <Stern className={css.eyebrowStern} />
              {t("heroText")}
            </p>
            <div className={css.titelZeile}>
              <h1 className={css.heroTitel}>{t.rich("heroTitel", { akzent })}</h1>
              {sticker ? (
                <span className={`sticker ${css.heroSticker}`}>
                  {sticker[0]}
                  <br />
                  <b>{sticker[1]}</b>
                </span>
              ) : null}
            </div>
            {naechstes ? (
              <p className={css.heroText}>
                {t("heroNaechste", {
                  titel: naechstes.titel,
                  datum: f.dateTime(new Date(naechstes.beginn), {
                    weekday: "long",
                    day: "2-digit",
                    month: "2-digit",
                  }),
                  ort: naechstes.ort.name,
                })}
              </p>
            ) : null}
            <div className={css.heroKnoepfe}>
              {naechstes ? (
                <Knopf href={ticketZiel} groesse="gross">
                  <Stern className={css.knopfStern} />
                  {t("ticketsSichern")}
                </Knopf>
              ) : (
                <Knopf href="/events" groesse="gross">
                  {t("heroCta")}
                </Knopf>
              )}
              <Knopf href="/about" stil="linie" groesse="gross">
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
          <section className={`abschnitt ${css.featured}`}>
            <div className="seitenbreite">
              <div className={css.kopfzeile}>
                <div className={css.kopfLinks}>
                  <span className="eyebrow">
                    <Stern className={css.eyebrowStern} />
                    {t("featuredEyebrow")}
                  </span>
                  <h2 className={css.abschnittTitel}>{t.rich("featuredTitel", { akzent })}</h2>
                </div>
              </div>
              <div className={`cosmos-host ${css.raster}`}>
                <Kosmos teil="planet-ringed" bewegung="float" className={css.planetRing} />
                <Kosmos teil="sparkle-cluster" bewegung="twinkle-langsam" className={css.funkelKarte} />
                {featured.map((e, i) => (
                  <EventKarte
                    key={e.id}
                    event={e}
                    prioritaet={i < 2}
                    breit={featured.length === 1}
                  />
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
                  <span className="eyebrow">
                    <Stern className={css.eyebrowStern} />
                    {t("kommendEyebrow")}
                  </span>
                  <h2 className={css.abschnittTitel}>{t("kommendTitel")}</h2>
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

        <section className={`abschnitt ${css.vipAbschnitt}`}>
          {/* Füller für die Lücke zwischen Eventkarte und VIP (Designs/cosmos) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cosmos/divider-cosmos.svg" className={`cosmos-divider ${css.trenner}`} alt="" aria-hidden="true" />
          <div className="seitenbreite">
            <VipSektion />
          </div>
        </section>

        <section className={`abschnitt ${css.about}`} data-grund="rosa">
          <span className={css.aboutGeist} aria-hidden="true">
            Lunar
          </span>
          <div className="seitenbreite">
            <div className={css.marke}>
              <div className={css.markeSpalte}>
                <span className="eyebrow">
                  <Stern className={css.eyebrowStern} />
                  {t("markeEyebrow")}
                </span>
                <h2 className={css.markeTitel}>{t.rich("markeTitel", { akzent })}</h2>
              </div>
              <div className={css.markeSpalte}>
                <p className={css.markeText}>{t("markeText")}</p>
                <Knopf href="/about">{t("heroCtaZwei")}</Knopf>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Fusszeile />
    </>
  );
}
