import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { PromoterFormular } from "@/components/PromoterFormular";
import { Link } from "@/i18n/navigation";
import { darfCodesAendern, holePromoter } from "@/lib/backoffice";
import { promoterStandAus, teilLinks } from "@/lib/promoter";
import { eigeneAdresse } from "@/lib/stripe";
import css from "../../backoffice.module.css";

type Props = { params: Promise<{ locale: string; id: string }> };

export const metadata: Metadata = {
  title: "Promoter",
  robots: { index: false, follow: false },
};

export default async function PromoterBearbeiten({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Promoter" />
      <Suspense fallback={<BackofficeSkelett zeilen={8} />}>
        <Inhalt id={id} locale={locale} />
      </Suspense>
    </>
  );
}

async function Inhalt({ id, locale }: { id: string; locale: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [daten, darf, f] = await Promise.all([
    holePromoter(id),
    darfCodesAendern(),
    getFormatter(),
  ]);
  if (!daten) notFound();

  const { promoter, codes, statistik } = daten;
  const adresse = eigeneAdresse();
  const events = statistik?.events ?? [];
  const klicks = events.reduce((s, e) => s + e.klicks, 0);
  const tickets = events.reduce((s, e) => s + e.tickets, 0);
  const links = statistik ? teilLinks(statistik, adresse, locale) : [];

  return (
    <>
      <div className={css.kennzahlen}>
        <div className={css.kachel}>
          <span className={css.kachelName}>Klicks</span>
          <span className={css.kachelWert}>{klicks}</span>
          <span className={css.kachelZusatz}>Aufrufe über den Link</span>
        </div>
        <div className={css.kachel}>
          <span className={css.kachelName}>Tickets</span>
          <span className={css.kachelWert}>{tickets}</span>
          <span className={css.kachelZusatz}>bezahlt, über Link oder Code</span>
        </div>
        <div className={css.kachel}>
          <span className={css.kachelName}>Codes</span>
          <span className={css.kachelWert}>{codes.length}</span>
          <span className={css.kachelZusatz}>
            {codes.length === 0
              ? "gibt keinen Rabatt"
              : codes.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 ? ", " : ""}
                    <Link href={`/backoffice/rabattcodes/${c.id}`}>{c.code}</Link>
                    {c.aktiv ? "" : " (pausiert)"}
                  </span>
                ))}
          </span>
        </div>
      </div>

      <PromoterFormular
        key={`${promoter.id}-${promoter.token}`}
        start={promoterStandAus(promoter)}
        darfAendern={darf}
        statistikLink={`${adresse}/promoter/${promoter.token}`}
        links={links.map((l) => ({ titel: l.titel, datum: l.datum, link: l.link, code: l.code }))}
      />

      <h2 className={css.seitentitel} style={{ marginTop: "3rem" }}>
        Je Event
      </h2>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Wann</th>
              <th className={css.zahl}>Klicks</th>
              <th className={css.zahl}>Tickets</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className={css.leer}>
                  Noch keine Zahlen.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} style={e.kommend ? undefined : { opacity: 0.6 }}>
                  <td className={css.haupt}>{e.titel}</td>
                  <td className={css.nebensache}>{f.dateTime(new Date(e.beginn), "lang")}</td>
                  <td className={css.zahl}>{e.klicks}</td>
                  <td className={css.zahl}>{e.tickets}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className={css.notiz}>
        Dieselben Zahlen sieht der Promoter hinter seinem Statistik-Link.
      </p>
    </>
  );
}
