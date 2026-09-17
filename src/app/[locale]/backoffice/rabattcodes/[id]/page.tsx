import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { RabattcodeFormular } from "@/components/RabattcodeFormular";
import {
  darfCodesAendern,
  holeEventWahl,
  holePromoterWahl,
  holeRabattcode,
} from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import { codeStandAus } from "@/lib/rabatt";
import { eigeneAdresse } from "@/lib/stripe";
import css from "../../backoffice.module.css";

type Props = { params: Promise<{ locale: string; id: string }> };

export const metadata: Metadata = {
  title: "Rabattcode",
  robots: { index: false, follow: false },
};

function marke(status: string) {
  if (status === "bezahlt") return css.gut;
  if (status === "offen") return css.warte;
  if (status === "abgelaufen") return css.neutral;
  return css.schlecht;
}

export default async function RabattcodeBearbeiten({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Rabattcode" />
      <Suspense fallback={<BackofficeSkelett zeilen={8} />}>
        <Inhalt id={id} locale={locale} />
      </Suspense>
    </>
  );
}

async function Inhalt({ id, locale }: { id: string; locale: string }) {
  // Keine gültige ID: gleich 404, statt die Datenbank mit Unsinn zu fragen.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [daten, events, darf, promoter, f] = await Promise.all([
    holeRabattcode(id),
    holeEventWahl(),
    darfCodesAendern(),
    holePromoterWahl(),
    getFormatter(),
  ]);
  if (!daten) notFound();

  const { code, einloesungen } = daten;
  const bezahlt = einloesungen.filter((e) => e.status === "bezahlt");
  const umsatz = bezahlt.reduce((s, e) => s + e.gesamtCent, 0);
  const reserviert = code.eingeloest - code.bezahltTickets;

  return (
    <>
      <div className={css.kennzahlen}>
        <div className={css.kachel}>
          <span className={css.kachelName}>Rabatt</span>
          {/* "je Ticket" steht in der kleinen Zeile — in der großen Schrift
              bräche der Betrag sonst um. */}
          <span className={css.kachelWert}>
            {code.art === "prozent" ? `${code.wert} %` : preisText(code.wert, locale)}
          </span>
          <span className={css.kachelZusatz}>
            {code.art === "betrag" ? "je Ticket · " : ""}
            {code.eventTitel ?? "Alle Events"}
          </span>
        </div>
        <div className={css.kachel}>
          <span className={css.kachelName}>Tickets gekauft</span>
          <span className={css.kachelWert}>{code.bezahltTickets}</span>
          <span className={css.kachelZusatz}>
            {reserviert > 0 ? `+ ${reserviert} gerade reserviert` : "mit Rabatt"}
          </span>
        </div>
        <div className={css.kachel}>
          <span className={css.kachelName}>Rabatt gegeben</span>
          <span className={css.kachelWert}>{preisText(code.bezahltRabattCent, locale)}</span>
          <span className={css.kachelZusatz}>nur bezahlte Bestellungen</span>
        </div>
        <div className={css.kachel}>
          <span className={css.kachelName}>Umsatz mit Code</span>
          <span className={css.kachelWert}>{preisText(umsatz, locale)}</span>
          <span className={css.kachelZusatz}>
            {bezahlt.length} {bezahlt.length === 1 ? "Bestellung" : "Bestellungen"}
          </span>
        </div>
      </div>

      <RabattcodeFormular
        key={code.id}
        start={codeStandAus(code)}
        events={events}
        darfAendern={darf}
        eingeloest={code.eingeloest}
        adresse={eigeneAdresse()}
        promoter={promoter}
      />

      <h2 className={css.seitentitel} style={{ marginTop: "3rem" }}>
        Einlösungen
      </h2>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Bestellung</th>
              <th>Wann</th>
              <th>Kunde</th>
              <th className={css.zahl}>Tickets mit Rabatt</th>
              <th className={css.zahl}>Rabatt</th>
              <th className={css.zahl}>Bezahlt</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {einloesungen.length === 0 ? (
              <tr>
                <td colSpan={7} className={css.leer}>
                  Noch niemand hat diesen Code benutzt.
                </td>
              </tr>
            ) : (
              einloesungen.map((e) => (
                <tr key={e.id}>
                  <td className={css.haupt}>{e.nummer}</td>
                  <td className={css.nebensache}>
                    {f.dateTime(new Date(e.erstelltAm), "mitZeit")}
                  </td>
                  <td>
                    {e.kunde}
                    <div className={css.nebensache}>
                      <a href={`mailto:${e.email}`}>{e.email}</a>
                    </div>
                  </td>
                  <td className={css.zahl}>{e.tickets}</td>
                  <td className={css.zahl}>− {preisText(e.rabattCent, locale)}</td>
                  <td className={css.zahl}>{preisText(e.gesamtCent, locale)}</td>
                  <td>
                    <span className={`${css.marke_} ${marke(e.status)}`}>
                      {e.status === "offen" && e.vorkasse ? "wartet auf Überweisung" : e.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className={css.notiz}>
        Abgelaufene Bestellungen stehen mit in der Liste, zählen aber nicht mehr
        als Einlösung — der Gast hat nicht bezahlt, der Code war wieder frei.
      </p>
    </>
  );
}
