import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Knopf } from "@/components/Knopf";
import { Link } from "@/i18n/navigation";
import { holeRabattcodes } from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import { codeZustand, rabattText, type CodeZustand } from "@/lib/rabatt";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Rabattcodes",
  robots: { index: false, follow: false },
};

const ZUSTAND: Record<CodeZustand, [string, string]> = {
  aktiv: ["aktiv", css.gut],
  geplant: ["geplant", css.warte],
  pausiert: ["pausiert", css.neutral],
  abgelaufen: ["abgelaufen", css.neutral],
  aufgebraucht: ["aufgebraucht", css.schlecht],
};

export default async function Rabattcodes({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Rabattcodes">
        <Knopf href="/backoffice/rabattcodes/neu" groesse="klein">
          Code anlegen
        </Knopf>
      </BackofficeKopf>
      <Suspense fallback={<BackofficeSkelett zeilen={6} />}>
        <Inhalt locale={locale} />
      </Suspense>
    </>
  );
}

async function Inhalt({ locale }: { locale: string }) {
  const [codes, f] = await Promise.all([holeRabattcodes(), getFormatter()]);

  return (
    <>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Rabatt</th>
              <th>Gilt für</th>
              <th>Zeitraum</th>
              <th>Eingelöst</th>
              <th className={css.zahl}>Rabatt bezahlt</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 ? (
              <tr>
                <td colSpan={7} className={css.leer}>
                  Noch keine Rabattcodes.
                </td>
              </tr>
            ) : (
              codes.map((c) => {
                const [zustandName, zustandKlasse] = ZUSTAND[codeZustand(c)];
                const anteil =
                  c.max_tickets !== null
                    ? Math.min(100, Math.round((c.eingeloest / c.max_tickets) * 100))
                    : null;
                return (
                  <tr key={c.id}>
                    <td className={css.haupt}>
                      <Link href={`/backoffice/rabattcodes/${c.id}`}>{c.code}</Link>
                      {c.notiz ? <div className={css.nebensache}>{c.notiz}</div> : null}
                    </td>
                    <td>{rabattText(c.art, c.wert)}</td>
                    <td>
                      {c.eventTitel ?? "Alle Events"}
                      {c.phasen_ids ? (
                        <div className={css.nebensache}>
                          {c.phasen_ids.length} {c.phasen_ids.length === 1 ? "Phase" : "Phasen"}
                        </div>
                      ) : null}
                      {c.einmal_pro_person ? (
                        <div className={css.nebensache}>einmal je Person</div>
                      ) : null}
                    </td>
                    <td className={css.nebensache}>
                      {c.gueltig_ab || c.gueltig_bis ? (
                        <>
                          {c.gueltig_ab ? f.dateTime(new Date(c.gueltig_ab), "kurz") : "…"}
                          {" – "}
                          {c.gueltig_bis ? f.dateTime(new Date(c.gueltig_bis), "kurz") : "…"}
                        </>
                      ) : (
                        "unbegrenzt"
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={css.zahl}>
                          {c.eingeloest}
                          {c.max_tickets !== null ? ` / ${c.max_tickets}` : ""}
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
                    <td className={css.zahl}>
                      {preisText(c.bezahltRabattCent, locale)}
                      <div className={css.nebensache}>
                        {c.bezahltTickets} {c.bezahltTickets === 1 ? "Ticket" : "Tickets"}
                      </div>
                    </td>
                    <td>
                      <span className={`${css.marke_} ${zustandKlasse}`}>{zustandName}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        „Eingelöst“ zählt rabattierte Tickets in bezahlten <em>und</em> offenen
        Bestellungen — wie beim Kontingent, denn eine laufende Reservierung hält
        die Einlösung fest. Verfällt sie, wird die Einlösung zurückgegeben.
        „Rabatt bezahlt“ zählt nur, was tatsächlich gekauft wurde.
      </p>
    </>
  );
}
