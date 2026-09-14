import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { holeAuswertung, holeHerkunft } from "@/lib/backoffice";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Auswertung",
  robots: { index: false, follow: false },
};

function anteil(oben: number, unten: number): string {
  if (unten === 0) return "—";
  return `${Math.round((oben / unten) * 100)} %`;
}

export default async function Auswertung({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Auswertung" />
      <Suspense fallback={<BackofficeSkelett kacheln={4} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const [zeilen, herkunft] = await Promise.all([
    holeAuswertung(90),
    holeHerkunft(30),
  ]);

  const gesamt = zeilen.reduce(
    (s, z) => ({
      gesehen: s.gesehen + z.gesehen,
      gewaehlt: s.gewaehlt + z.gewaehlt,
      kasse: s.kasse + z.kasse,
      gekauft: s.gekauft + z.gekauft,
    }),
    { gesehen: 0, gewaehlt: 0, kasse: 0, gekauft: 0 },
  );

  const trichter: Array<[string, number, number]> = [
    ["Event angesehen", gesamt.gesehen, gesamt.gesehen],
    ["Ticket gewählt", gesamt.gewaehlt, gesamt.gesehen],
    ["Kasse geöffnet", gesamt.kasse, gesamt.gesehen],
    ["Gekauft", gesamt.gekauft, gesamt.gesehen],
  ];

  return (
    <>
      <div className={css.kennzahlen}>
        {trichter.map(([name, wert, bezug]) => (
          <div key={name} className={css.kachel}>
            <span className={css.kachelName}>{name}</span>
            <span className={css.kachelWert}>{wert}</span>
            <span className={css.kachelZusatz}>
              {name === "Event angesehen" ? "letzte 90 Tage" : anteil(wert, bezug)}
            </span>
          </div>
        ))}
      </div>

      <h2 className={css.seitentitel} style={{ fontSize: "1.25rem" }}>
        Je Event
      </h2>

      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Event</th>
              <th className={css.zahl}>Angesehen</th>
              <th className={css.zahl}>Gewählt</th>
              <th className={css.zahl}>Kasse</th>
              <th className={css.zahl}>Gekauft</th>
              <th className={css.zahl}>Quote</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 ? (
              <tr>
                <td colSpan={6} className={css.leer}>
                  Noch keine Zahlen. Sie entstehen, sobald jemand die Seite
                  besucht.
                </td>
              </tr>
            ) : (
              zeilen.map((z) => (
                <tr key={z.eventId}>
                  <td className={css.haupt}>{z.titel}</td>
                  <td className={css.zahl}>{z.gesehen}</td>
                  <td className={css.zahl}>{z.gewaehlt}</td>
                  <td className={css.zahl}>{z.kasse}</td>
                  <td className={css.zahl}>{z.gekauft}</td>
                  <td className={css.zahl}>{anteil(z.gekauft, z.gesehen)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className={css.seitentitel} style={{ fontSize: "1.25rem", marginTop: "2.5rem" }}>
        Woher die Aufrufe kommen
      </h2>

      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Quelle</th>
              <th className={css.zahl}>Aufrufe (30 Tage)</th>
            </tr>
          </thead>
          <tbody>
            {herkunft.length === 0 ? (
              <tr>
                <td colSpan={2} className={css.leer}>
                  Noch nichts erfasst.
                </td>
              </tr>
            ) : (
              herkunft.map((h) => (
                <tr key={h.quelle}>
                  <td className={css.haupt}>{h.quelle}</td>
                  <td className={css.zahl}>{h.anzahl}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        Gezählt wird ohne Cookie, ohne Kennung und ohne IP-Adresse — deshalb
        braucht diese Auswertung keinen Einwilligungsdialog. Der Preis dafür:
        Das sind <strong>Aufrufe</strong>, keine Besucher. Wer zweimal
        hinschaut, zählt zweimal, und die Quote fällt entsprechend
        niedriger aus als bei Anbietern, die Personen wiedererkennen.
        Für die Frage „welches Event zieht besser?" reicht das; für „wie
        viele verschiedene Leute waren da?" nicht.
      </p>
    </>
  );
}
