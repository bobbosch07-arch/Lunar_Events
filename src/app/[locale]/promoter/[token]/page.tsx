import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { KopierFeld } from "@/components/KopierFeld";
import { Logo } from "@/components/Logo";
import { preisText } from "@/lib/format";
import { teilLinks } from "@/lib/promoter";
import { eigeneAdresse } from "@/lib/stripe";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import type { PromoterStatistik } from "@/lib/typen";
import css from "./promoter.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Promoter",
  robots: { index: false, follow: false, nocache: true },
  // Der Token steht in der Adresse. Ohne das reiste er beim Klick auf einen
  // Link als Herkunft mit.
  referrer: "no-referrer",
};

/**
 * Was ein Promoter hinter seinem geheimen Link sieht — ohne Anmeldung, wie
 * beim Ticketlink. Nur Klicks und bezahlte Tickets je Event, keine Namen,
 * kein Umsatz (Rückfragen 17.09.2026).
 *
 * Die Zahlen kommen aus promoter_statistik(), derselben Funktion, die auch
 * das Backoffice benutzt. Sie ist nur mit dem Dienstschlüssel aufrufbar,
 * damit sich Tokens nicht über die Schnittstelle durchprobieren lassen.
 */
export default async function PromoterSeite({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  if (!datenbankVerbunden() || token.length < 32) notFound();

  const { data } = await dienstClient().rpc("promoter_statistik", { p_token: token });
  const statistik = data as PromoterStatistik | null;
  if (!statistik) notFound();

  const [t, f] = await Promise.all([getTranslations("promoter"), getFormatter()]);

  const links = teilLinks(statistik, eigeneAdresse(), locale);
  const klicks = statistik.events.reduce((s, e) => s + e.klicks, 0);
  const tickets = statistik.events.reduce((s, e) => s + e.tickets, 0);
  const mitZahlen = statistik.events.filter((e) => e.klicks > 0 || e.tickets > 0);

  const rabattFuer = (code: string) => {
    const c = statistik.codes.find((x) => x.code === code);
    if (!c) return null;
    return c.art === "prozent" ? `${c.wert} %` : preisText(c.wert, locale);
  };

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="navy" hoehe={40} prioritaet />
          </Link>
        </div>
      </header>

      <main className={`seitenbreite ${css.inhalt}`}>
        <div className={css.kopfzeile}>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className={css.titel}>{t("hallo", { name: statistik.name })}</h1>
          <p className={css.intro}>{t("intro")}</p>
        </div>

        {!statistik.aktiv ? <p className={css.pausiert}>{t("pausiert")}</p> : null}

        <div className={css.summen}>
          <div className={css.summe}>
            <span className={css.summeName}>{t("klicks")}</span>
            <span className={css.summeWert}>{klicks}</span>
          </div>
          <div className={css.summe}>
            <span className={css.summeName}>{t("tickets")}</span>
            <span className={css.summeWert}>{tickets}</span>
          </div>
        </div>

        <section className={css.abschnitt}>
          <h2 className={css.abschnittTitel}>{t("linksTitel")}</h2>
          {links.length === 0 ? (
            <p className={css.abschnittText}>{t("keineEvents")}</p>
          ) : (
            <>
              <p className={css.abschnittText}>{t("linksText")}</p>
              {links.map((l) => {
                const rabatt = l.code ? rabattFuer(l.code) : null;
                return (
                  <div key={l.eventId} className={css.linkKarte}>
                    <div className={css.linkKopf}>
                      <span className={css.linkTitel}>{l.titel}</span>
                      <span className={css.linkDatum}>{l.datum}</span>
                    </div>
                    {l.code && rabatt ? (
                      <p className={css.linkCode}>{t("mitCode", { code: l.code, rabatt })}</p>
                    ) : null}
                    <KopierFeld
                      wert={l.link}
                      beschriftung={t("kopieren")}
                      kopiert={t("kopiert")}
                      klasse={css.kopierReihe}
                      wertKlasse={css.kopierWert}
                    />
                  </div>
                );
              })}
            </>
          )}
        </section>

        <section className={css.abschnitt}>
          <h2 className={css.abschnittTitel}>{t("zahlenTitel")}</h2>
          {mitZahlen.length === 0 ? (
            <p className={css.abschnittText}>{t("keineZahlen")}</p>
          ) : (
            <ul className={css.zeilen}>
              <li className={`${css.zeile} ${css.zeileKopf}`} aria-hidden="true">
                <span />
                <span className={css.zahl}>{t("klicks")}</span>
                <span className={css.zahl}>{t("tickets")}</span>
              </li>
              {mitZahlen.map((e) => (
                <li key={e.id} className={`${css.zeile} ${e.kommend ? "" : css.vorbei}`}>
                  <span className={css.zeileEvent}>
                    <span className={css.zeileTitel}>{e.titel}</span>
                    <span className={css.zeileDatum}>{f.dateTime(new Date(e.beginn), "lang")}</span>
                  </span>
                  <span className={css.zahl}>
                    <span className="nur-sr">{t("klicks")}: </span>
                    {e.klicks}
                  </span>
                  <span className={css.zahl}>
                    <span className="nur-sr">{t("tickets")}: </span>
                    {e.tickets}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={css.fussnote}>
          <p>{t("hinweis")}</p>
          <p>{t("geheim")}</p>
        </div>
      </main>
    </div>
  );
}
