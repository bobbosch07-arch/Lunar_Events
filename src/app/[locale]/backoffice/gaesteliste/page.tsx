import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Link } from "@/i18n/navigation";
import { holeEventZeilen } from "@/lib/backoffice";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Gästeliste",
  robots: { index: false, follow: false },
};

/** Welches Event? Die Gästeliste hängt immer an genau einem. */
export default async function GaestelisteUebersicht({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Gästeliste" />
      <Suspense fallback={<BackofficeSkelett zeilen={6} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const [events, f] = await Promise.all([holeEventZeilen({ abJetzt: true }), getFormatter()]);

  return (
    <>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Wann</th>
              <th>Status</th>
              <th className={css.zahl}>Gästeliste</th>
              <th className={css.zahl}>Verkauft</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={5} className={css.leer}>
                  Keine kommenden Events.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id}>
                  <td className={css.haupt}>
                    <Link href={`/backoffice/gaesteliste/${e.slug}`}>{e.titel}</Link>
                  </td>
                  <td>{f.dateTime(new Date(e.beginn), "kurz")}</td>
                  <td className={css.nebensache}>{e.status}</td>
                  <td className={css.zahl}>{e.gaeste}</td>
                  <td className={css.zahl}>
                    {e.verkauft}
                    {e.kontingent !== null ? ` / ${e.kontingent}` : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className={css.notiz}>
        Die Gästeliste kommt obendrauf: Sie nimmt keinem Kontingent etwas weg. Zusammen mit
        den verkauften Tickets sollte sie in die Location passen.
      </p>
    </>
  );
}
