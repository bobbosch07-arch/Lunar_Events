import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { KopierFeld } from "@/components/KopierFeld";
import { Logo } from "@/components/Logo";
import { preisText } from "@/lib/format";
import { staffelStand, teilLinks } from "@/lib/promoter";
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
  // Staffel nur für kommende Events mit Stufen (0040). Vergangene stehen
  // weiter unter „Deine Zahlen“.
  const mitStaffel = statistik.events
    .filter((e) => e.kommend && (e.stufen?.length ?? 0) > 0)
    .sort((a, b) => a.beginn.localeCompare(b.beginn));

  const rabattFuer = (code: string) => {
    // Der Link zeigt die Schreibweise („Niklas“), gespeichert ist NIKLAS.
    const c = statistik.codes.find((x) => x.code === code.toUpperCase());
    if (!c || c.art === "promoter") return null;
    return c.art === "prozent" ? `${c.wert} %` : preisText(c.wert, locale);
  };

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="farbig" hoehe={44} prioritaet />
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

        {mitStaffel.length > 0 ? (
          <section className={css.abschnitt}>
            <h2 className={css.abschnittTitel}>{t("staffelTitel")}</h2>
            {mitStaffel.map((e) => {
              const stand = staffelStand(e.tickets_staffel, e.stufen);
              const ziel = Math.max(...e.stufen.map((x) => x.ab));
              const weg = e.weg;
              return (
                <div key={e.id} className={css.staffel}>
                  <div className={css.linkKopf}>
                    <span className={css.linkTitel}>{e.titel}</span>
                    {e.stichtag ? (
                      <span className={css.linkDatum}>
                        {t("stichtag", { datum: f.dateTime(new Date(e.stichtag), "lang") })}
                      </span>
                    ) : null}
                  </div>

                  <div className={css.staffelZahl}>
                    <span className={css.summeWert}>{e.tickets_staffel}</span>
                    <span className={css.summeName}>{t("staffelTickets")}</span>
                  </div>

                  {/* Balken über die ganze Staffel, die Stufen als Marken darauf. */}
                  <div
                    className={css.balken}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={ziel}
                    aria-valuenow={Math.min(e.tickets_staffel, ziel)}
                    aria-label={t("staffelTickets")}
                  >
                    <span className={css.balkenFuellung} style={{ width: `${stand.anteil}%` }} />
                    {e.stufen.map((x) => (
                      <span
                        key={x.ab}
                        className={`${css.marke} ${e.tickets_staffel >= x.ab ? css.markeErreicht : ""}`}
                        style={{ left: `${(x.ab / ziel) * 100}%` }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>

                  <p className={css.staffelNaechste}>
                    {stand.naechste
                      ? t("nochBis", { anzahl: stand.fehlen, belohnung: stand.naechste.belohnung })
                      : t("alleErreicht")}
                  </p>

                  <ul className={css.stufen}>
                    {e.stufen.map((x) => {
                      const geschafft = e.tickets_staffel >= x.ab;
                      return (
                        <li key={x.ab} className={`${css.stufe} ${geschafft ? css.stufeErreicht : ""}`}>
                          <span className={css.stufeHaken} aria-hidden="true">
                            {geschafft ? "✓" : ""}
                          </span>
                          <span className={css.stufeAb}>{t("stufe", { ab: x.ab })}</span>
                          <span>{x.belohnung}</span>
                        </li>
                      );
                    })}
                  </ul>

                  {weg && e.tickets > 0 ? (
                    <p className={css.abschnittText}>
                      {t("weg", { link: weg.link, code: weg.code, beides: weg.beides })}
                    </p>
                  ) : null}
                  <p className={css.abschnittText}>{t("staffelHinweis")}</p>
                </div>
              );
            })}
          </section>
        ) : null}

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
                    {l.code && l.mitRabatt && rabatt ? (
                      <p className={css.linkCode}>{t("mitCode", { code: l.code, rabatt })}</p>
                    ) : l.code ? (
                      <p className={css.linkCode}>{t("deinCode", { code: l.code })}</p>
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
