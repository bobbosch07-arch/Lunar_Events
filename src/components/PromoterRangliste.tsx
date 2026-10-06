import { serverClient } from "@/lib/supabase/server";
import { staffelStand } from "@/lib/promoter";
import type { PromoterStufe } from "@/lib/typen";
import bo from "@/app/[locale]/backoffice/backoffice.module.css";

type Zeile = {
  promoter_id: string;
  name: string;
  aktiv: boolean;
  tickets: number;
  link: number;
  code: number;
  beides: number;
  frueher: number;
  erreicht_am: string | null;
};

/**
 * Rangliste der Promoter für ein Event (0040), nur fürs Backoffice. Die
 * Promoter selbst sehen nur ihre eigene Zahl (Konzept: Zwischenstände nur
 * als Tendenz). Reihenfolge und Gleichstand rechnet `promoter_rangliste`:
 * bei gleicher Zahl vorn, wer sie zuerst erreicht hat.
 */
export async function PromoterRangliste({
  eventId,
  stufen,
  stichtag,
}: {
  eventId: string;
  stufen: PromoterStufe[];
  stichtag: string | null;
}) {
  const db = await serverClient();
  const { data, error } = await db.rpc("promoter_rangliste", { p_event_id: eventId });
  if (error) {
    return <p className={bo.notiz}>Rangliste nicht verfügbar: {error.message}</p>;
  }
  const zeilen = (data ?? []) as Zeile[];
  const zeit = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  const mitFrueher = zeilen.some((z) => z.frueher > 0);

  return (
    <div style={{ maxWidth: 940, marginTop: "2rem" }}>
      <h2 className={bo.seitentitel} style={{ fontSize: "1.25rem" }}>
        Rangliste der Promoter
      </h2>
      <div className={bo.tabellenfeld}>
        <table className={bo.tabelle}>
          <thead>
            <tr>
              <th className={bo.zahl}>Platz</th>
              <th>Promoter</th>
              <th className={bo.zahl}>Tickets</th>
              <th>Stufe</th>
              <th className={bo.zahl}>Link</th>
              <th className={bo.zahl}>Code</th>
              <th className={bo.zahl}>Beides</th>
              {mitFrueher ? <th className={bo.zahl}>Früher</th> : null}
              <th>Erreicht am</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 ? (
              <tr>
                <td colSpan={mitFrueher ? 9 : 8} className={bo.leer}>
                  Noch keine Verkäufe über Promoter.
                </td>
              </tr>
            ) : (
              zeilen.map((z, i) => {
                const stand = staffelStand(z.tickets, stufen);
                const hoechste = stand.erreicht.at(-1);
                return (
                  <tr key={z.promoter_id}>
                    <td className={bo.zahl}>{i + 1}</td>
                    <td className={bo.haupt}>
                      {z.name}
                      {z.aktiv ? null : <div className={bo.nebensache}>pausiert</div>}
                    </td>
                    <td className={bo.zahl}>{z.tickets}</td>
                    <td className={bo.nebensache}>
                      {hoechste ? `ab ${hoechste.ab}: ${hoechste.belohnung}` : "—"}
                      {stand.naechste ? (
                        <div>
                          noch {stand.fehlen} bis {stand.naechste.ab}
                        </div>
                      ) : null}
                    </td>
                    <td className={bo.zahl}>{z.link}</td>
                    <td className={bo.zahl}>{z.code}</td>
                    <td className={bo.zahl}>{z.beides}</td>
                    {mitFrueher ? <td className={bo.zahl}>{z.frueher}</td> : null}
                    <td className={bo.nebensache}>
                      {z.erreicht_am ? zeit.format(new Date(z.erreicht_am)) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className={bo.notiz}>
        Gezählt werden bezahlte, nicht stornierte Tickets
        {stichtag ? ` bis ${zeit.format(new Date(stichtag))} Uhr` : ""}, je
        Bestellung einmal: Kam jemand über den Link und hat den Code
        eingegeben, steht die Bestellung unter „Beides“, nicht zweimal. Über
        den Link eines anderen zählt der Code. „Erreicht am“ entscheidet bei
        Gleichstand: vorn, wer die Zahl zuerst hatte.
        {mitFrueher ? " „Früher“: Bestellungen vom 06.10.2026 und davor, als der Weg noch nicht gespeichert wurde." : ""}
      </p>
    </div>
  );
}
