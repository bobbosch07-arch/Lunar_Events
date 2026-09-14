import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Aufraeumknopf } from "@/components/Aufraeumknopf";
import { VorkasseEingang } from "@/components/VorkasseEingang";
import { holeBestellungen } from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Bestellungen",
  robots: { index: false, follow: false },
};

function marke(status: string) {
  if (status === "bezahlt") return css.gut;
  if (status === "offen") return css.warte;
  if (status === "abgelaufen") return css.neutral;
  return css.schlecht;
}

export default async function Bestellungen({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Bestellungen">
        <Aufraeumknopf />
      </BackofficeKopf>
      <Suspense fallback={<BackofficeSkelett zeilen={10} />}>
        <Inhalt locale={locale} />
      </Suspense>
    </>
  );
}

async function Inhalt({ locale }: { locale: string }) {
  const [bestellungen, f] = await Promise.all([
    holeBestellungen(150),
    getFormatter(),
  ]);

  return (
    <>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Nummer</th>
              <th>Event</th>
              <th>Kunde</th>
              <th className={css.zahl}>Tickets</th>
              <th className={css.zahl}>Betrag</th>
              <th>Zahlung</th>
              <th>Wann</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {bestellungen.length === 0 ? (
              <tr>
                <td colSpan={8} className={css.leer}>
                  Noch keine Bestellungen.
                </td>
              </tr>
            ) : (
              bestellungen.map((b) => (
                <tr key={b.id}>
                  <td className={css.haupt}>{b.nummer}</td>
                  <td>{b.event}</td>
                  <td>
                    {b.kunde}
                    <div className={css.nebensache}>
                      <a href={`mailto:${b.email}`}>{b.email}</a>
                    </div>
                  </td>
                  <td className={css.zahl}>{b.tickets}</td>
                  <td className={css.zahl}>{preisText(b.gesamtCent, locale)}</td>
                  <td className={css.nebensache}>
                    {b.zahlungsart === "frei"
                      ? "Testkauf"
                      : b.vorkasse
                        ? "Überweisung"
                        : (b.zahlungsart ?? "—")}
                  </td>
                  <td className={css.nebensache}>
                    {f.dateTime(new Date(b.erstelltAm), "kurz")}
                  </td>
                  <td>
                    <span className={`${css.marke_} ${marke(b.status)}`}>
                      {b.status === "offen" && b.vorkasse ? "wartet auf Überweisung" : b.status}
                    </span>
                    {b.status === "offen" && b.vorkasse ? (
                      <div style={{ marginTop: 8 }}>
                        {b.reserviertBis ? (
                          <div className={css.nebensache}>
                            Frist {f.dateTime(new Date(b.reserviertBis), "kurz")}
                          </div>
                        ) : null}
                        <VorkasseEingang
                          bestellungId={b.id}
                          nummer={b.nummer}
                          betrag={preisText(b.gesamtCent, locale)}
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        „Offen" heißt reserviert, aber nicht bezahlt — diese Tickets blockieren
        Kontingent, bis die Frist abläuft. „Abgelaufen" heißt, die Frist ist
        vorbei und das Kontingent wurde zurückgegeben. Zeigt die Liste viele
        offene Bestellungen mit alten Zeitstempeln, fehlt der Aufräumlauf.
      </p>
    </>
  );
}
