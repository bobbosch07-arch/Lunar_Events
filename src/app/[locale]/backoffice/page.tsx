import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Link } from "@/i18n/navigation";
import { holeKennzahlen, holeEventZeilen } from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import { appleEingerichtet, zertifikatLaeuftAb } from "@/lib/wallet/apple";
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
    <>
      <BackofficeKopf titel="Übersicht" />
      <Suspense fallback={<BackofficeSkelett kacheln={4} />}>
        <Inhalt locale={locale} />
      </Suspense>
    </>
  );
}

async function Inhalt({ locale }: { locale: string }) {
  const [zahlen, events, f, passAblauf] = await Promise.all([
    holeKennzahlen(),
    holeEventZeilen({ abJetzt: true, grenze: 6 }),
    getFormatter(),
    appleEingerichtet() ? zertifikatLaeuftAb() : Promise.resolve(null),
  ]);

  // Apple stellt das Signaturzertifikat für 398 Tage aus. Läuft es ab,
  // lassen sich keine neuen Pässe mehr ausstellen — bereits ausgegebene
  // bleiben gültig. Ohne Vorwarnung fällt das mitten im Vorverkauf auf.
  const tageBisAblauf = passAblauf
    ? Math.floor((passAblauf.getTime() - Date.now()) / 86400000)
    : null;

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

      {tageBisAblauf !== null && tageBisAblauf < 45 ? (
        <p className={css.notiz} style={{ marginTop: 0, marginBottom: "1.5rem" }}>
          <strong>
            Das Apple-Wallet-Zertifikat läuft in {tageBisAblauf} Tagen ab
            {passAblauf ? ` (${f.dateTime(passAblauf, "lang")})` : ""}.
          </strong>{" "}
          Danach lassen sich keine neuen Pässe mehr ausstellen; bereits
          ausgegebene bleiben gültig. Erneuern im Apple-Developer-Portal
          unter der Pass Type ID.
        </p>
      ) : null}

      {zahlen.abgelaufeneReservierungen > 0 ? (
        <p className={css.notiz}>
          <strong>{zahlen.abgelaufeneReservierungen}</strong> Reservierungen sind
          abgelaufen, ohne dass jemand gezahlt hat. Der Aufräumlauf gibt die
          Kontingente alle fünf Minuten von selbst frei — steht die Zahl
          dauerhaft hoch, läuft er nicht.
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
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className={css.leer}>
                  Keine kommenden Events.
                </td>
              </tr>
            ) : (
              events.map((e) => {
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
