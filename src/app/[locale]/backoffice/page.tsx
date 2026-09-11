import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { BackofficeRahmen } from "@/components/BackofficeRahmen";
import { Link } from "@/i18n/navigation";
import { holeKennzahlen, holeEventZeilen } from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import css from "./backoffice.module.css";

export const metadata: Metadata = {
  title: "Backoffice",
  robots: { index: false, follow: false },
};

export default async function Uebersicht({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <BackofficeRahmen aktiv="/backoffice" titel="Übersicht">
      <Inhalt locale={locale} />
    </BackofficeRahmen>
  );
}

async function Inhalt({ locale }: { locale: string }) {
  const [zahlen, events, f] = await Promise.all([
    holeKennzahlen(),
    holeEventZeilen(),
    getFormatter(),
  ]);

  const kommende = events
    .filter((e) => new Date(e.beginn).getTime() > Date.now())
    .sort((a, b) => a.beginn.localeCompare(b.beginn))
    .slice(0, 6);

  const kacheln: Array<[string, string, string?]> = [
    ["Umsatz", preisText(zahlen.umsatzCent, locale), `${zahlen.bezahlteBestellungen} Bestellungen`],
    ["Tickets verkauft", String(zahlen.verkaufteTickets), `${zahlen.entwerteteTickets} eingelöst`],
    ["Kommende Events", String(zahlen.kommendeEvents)],
    [
      "VIP offen",
      String(zahlen.offeneVip),
      zahlen.offeneVip > 0 ? "warten auf Antwort" : "nichts offen",
    ],
  ];

  return (
    <>
      <div className={css.kennzahlen}>
        {kacheln.map(([name, wert, zusatz]) => (
          <div key={name} className={css.kachel}>
            <span className={css.kachelName}>{name}</span>
            <span className={css.kachelWert}>{wert}</span>
            {zusatz ? <span className={css.kachelZusatz}>{zusatz}</span> : null}
          </div>
        ))}
      </div>

      {zahlen.abgelaufeneReservierungen > 0 ? (
        <p className={css.notiz}>
          <strong>{zahlen.abgelaufeneReservierungen}</strong> Reservierungen sind
          abgelaufen, ohne dass jemand gezahlt hat. Ihre Kontingente sind noch
          blockiert — der Aufräumlauf (<code>raeume_reservierungen_auf</code>)
          gibt sie frei, sobald er eingerichtet ist.
        </p>
      ) : null}

      <h2 className={css.seitentitel} style={{ fontSize: "1.25rem", marginTop: "2rem" }}>
        Nächste Events
      </h2>

      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Wann</th>
              <th>Ort</th>
              <th>Verkauft</th>
              <th className={css.zahl}>Umsatz</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {kommende.length === 0 ? (
              <tr>
                <td colSpan={6} className={css.leer}>
                  Keine kommenden Events.
                </td>
              </tr>
            ) : (
              kommende.map((e) => {
                const anteil =
                  e.kontingent && e.kontingent > 0
                    ? Math.min(100, Math.round((e.verkauft / e.kontingent) * 100))
                    : null;
                return (
                  <tr key={e.id}>
                    <td className={css.haupt}>
                      <Link href={`/backoffice/events/${e.slug}`}>{e.titel}</Link>
                    </td>
                    <td>{f.dateTime(new Date(e.beginn), "kurz")}</td>
                    <td className={css.nebensache}>{e.ort}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={css.zahl}>
                          {e.verkauft}
                          {e.kontingent !== null ? ` / ${e.kontingent}` : ""}
                        </span>
                        {anteil !== null ? (
                          <span className={css.balken} aria-hidden="true">
                            <span
                              className={`${css.balkenFuellung} ${anteil >= 100 ? css.balkenVoll : ""}`}
                              style={{ width: `${anteil}%` }}
                            />
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={css.zahl}>{preisText(e.umsatzCent, locale)}</td>
                    <td>
                      <span
                        className={`${css.marke_} ${
                          e.status === "veroeffentlicht"
                            ? css.gut
                            : e.status === "entwurf"
                              ? css.warte
                              : css.schlecht
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        Die Zahlen kommen direkt aus der Datenbank, ohne Zwischenspeicher —
        was hier steht, gilt in diesem Moment. Umsatz zählt nur bezahlte
        Bestellungen; reservierte, aber nicht bezahlte Tickets tauchen unter
        „Verkauft" auf, weil sie das Kontingent tatsächlich blockieren.
      </p>
    </>
  );
}
