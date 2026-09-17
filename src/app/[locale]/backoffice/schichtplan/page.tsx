import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Link } from "@/i18n/navigation";
import { holeEventZeilen } from "@/lib/backoffice";
import { serverClient } from "@/lib/supabase/server";
import { schichtStunden } from "@/lib/typen";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Schichtplan",
  robots: { index: false, follow: false },
};

/** Welches Event? Ein Schichtplan gehört immer zu genau einem Abend. */
export default async function SchichtplanUebersicht({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Schichtplan" />
      <Suspense fallback={<BackofficeSkelett zeilen={6} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const db = await serverClient();
  const [events, f, { data: schichten }] = await Promise.all([
    holeEventZeilen({ abJetzt: true }),
    getFormatter(),
    db
      .from("schichten")
      .select("event_id, beginn, ende, pause_min, eingecheckt_am, ausgecheckt_am"),
  ]);

  const jeEvent = new Map<string, { anzahl: number; stunden: number }>();
  for (const s of schichten ?? []) {
    const id = s.event_id as string;
    const alt = jeEvent.get(id) ?? { anzahl: 0, stunden: 0 };
    jeEvent.set(id, {
      anzahl: alt.anzahl + 1,
      stunden:
        alt.stunden +
        schichtStunden({
          beginn: s.beginn as string,
          ende: s.ende as string,
          pause_min: s.pause_min as number,
          eingecheckt_am: s.eingecheckt_am as string | null,
          ausgecheckt_am: s.ausgecheckt_am as string | null,
        }),
    });
  }

  return (
    <>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Wann</th>
              <th>Status</th>
              <th className={css.zahl}>Schichten</th>
              <th className={css.zahl}>Stunden</th>
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
              events.map((e) => {
                const zahlen = jeEvent.get(e.id) ?? { anzahl: 0, stunden: 0 };
                return (
                  <tr key={e.id}>
                    <td className={css.haupt}>
                      <Link href={`/backoffice/schichtplan/${e.slug}`}>{e.titel}</Link>
                    </td>
                    <td>{f.dateTime(new Date(e.beginn), "kurz")}</td>
                    <td className={css.nebensache}>{e.status}</td>
                    <td className={css.zahl}>{zahlen.anzahl}</td>
                    <td className={css.zahl}>{zahlen.stunden.toFixed(2).replace(".", ",")}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className={css.notiz}>
        Jede Person sieht ihre eigenen Schichten unter „Mein Plan“, sobald sie sich anmeldet —
        dort steht immer der aktuelle Stand, auch wenn sich nach dem Verschicken etwas ändert.
      </p>
    </>
  );
}
