import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { EventStatusWahl } from "@/components/EventStatusWahl";
import { Knopf } from "@/components/Knopf";
import { Link } from "@/i18n/navigation";
import { holeEventZeilen } from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Events",
  robots: { index: false, follow: false },
};

export default async function EventsBackoffice({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Events">
        <Knopf href="/backoffice/events/neu" groesse="klein">
          Event anlegen
        </Knopf>
      </BackofficeKopf>
      <Suspense fallback={<BackofficeSkelett zeilen={8} />}>
        <Inhalt locale={locale} />
      </Suspense>
    </>
  );
}

async function Inhalt({ locale }: { locale: string }) {
  const [events, f] = await Promise.all([holeEventZeilen(), getFormatter()]);
  const jetzt = Date.now();

  return (
    <>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Wann</th>
              <th>Ort</th>
              <th className={css.zahl}>Phasen</th>
              <th>Verkauft</th>
              <th className={css.zahl}>Umsatz</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className={css.leer}>
                  Noch keine Events angelegt.
                </td>
              </tr>
            ) : (
              events.map((e) => {
                const vorbei = new Date(e.beginn).getTime() < jetzt;
                const anteil =
                  e.kontingent && e.kontingent > 0
                    ? Math.min(100, Math.round((e.verkauft / e.kontingent) * 100))
                    : null;
                return (
                  <tr key={e.id} style={vorbei ? { opacity: 0.6 } : undefined}>
                    <td className={css.haupt}>
                      <Link href={`/backoffice/events/${e.slug}`}>{e.titel}</Link>
                      <div className={css.nebensache}>{e.slug}</div>
                    </td>
                    <td>{f.dateTime(new Date(e.beginn), "kurz")}</td>
                    <td className={css.nebensache}>{e.ort}</td>
                    <td className={css.zahl}>{e.phasen}</td>
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
                      {e.gaeste > 0 ? (
                        <div className={css.nebensache}>+ {e.gaeste} Gästeliste</div>
                      ) : null}
                    </td>
                    <td className={css.zahl}>{preisText(e.umsatzCent, locale)}</td>
                    <td>
                      <EventStatusWahl id={e.id} status={e.status} titel={e.titel} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        „Verkauft" zählt alle Standardphasen zusammen und enthält auch
        laufende Reservierungen — das ist Absicht, denn die blockieren
        tatsächlich Plätze. Der Umsatz zählt dagegen nur bezahlte
        Bestellungen. Die Gästeliste kommt obendrauf und steht deshalb
        darunter, nicht darin.
      </p>
    </>
  );
}
