import { serverClient } from "@/lib/supabase/server";
import { wartelisteZustand, type WartelisteZustand } from "@/lib/typen";
import formular from "./EventFormular.module.css";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

const NAMEN: Record<WartelisteZustand, [string, string]> = {
  unbestaetigt: ["Unbestätigt", css.neutral],
  wartet: ["Wartet", css.warte],
  angeboten: ["Angebot läuft", css.gut],
  ueberweisung: ["Überweisung offen", css.gut],
  gekauft: ["Gekauft", css.gut],
  verfallen: ["Verfallen", css.schlecht],
  ausgetragen: ["Ausgetragen", css.neutral],
};

/**
 * Die Warteliste eines Events auf seiner Bearbeiten-Seite. Nur lesend: Wer
 * wartet, bekommt Plätze automatisch — sobald eine Reservierung verfällt
 * oder hier ein Kontingent erhöht und gespeichert wird.
 */
export async function WartelisteUebersicht({ eventId }: { eventId: string }) {
  const db = await serverClient();
  const { data } = await db
    .from("warteliste")
    .select(
      `id, email, vorname, anzahl, erstellt_am, bestaetigt_am, ausgetragen_am, angebot_am,
       bestellung:bestellungen(nummer, status, vorkasse, reserviert_bis)`,
    )
    .eq("event_id", eventId)
    .order("bestaetigt_am", { ascending: true, nullsFirst: false })
    .order("erstellt_am", { ascending: true })
    .limit(500);

  const zeilen = (data ?? []).map((z) => {
    const bestellung = z.bestellung as unknown as {
      nummer: string;
      status: string;
      vorkasse: boolean;
      reserviert_bis: string | null;
    } | null;
    return {
      id: z.id as string,
      email: z.email as string,
      vorname: (z.vorname as string | null) ?? null,
      anzahl: z.anzahl as number,
      bestaetigtAm: (z.bestaetigt_am as string | null) ?? null,
      bestellung,
      zustand: wartelisteZustand(
        {
          bestaetigt_am: z.bestaetigt_am as string | null,
          ausgetragen_am: z.ausgetragen_am as string | null,
          angebot_am: z.angebot_am as string | null,
        },
        bestellung,
      ),
    };
  });

  if (zeilen.length === 0) return null;

  const wartend = zeilen.filter((z) => z.zustand === "wartet");
  const zaehle = (zustand: WartelisteZustand) => zeilen.filter((z) => z.zustand === zustand).length;
  const zeit = (iso: string) =>
    new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

  // Die Reihenfolge der Liste: wer wartet, nach Bestätigung. Alle anderen
  // stehen darunter, damit man sieht, was aus früheren Einträgen wurde.
  const reihe = new Map(wartend.map((z, i) => [z.id, i + 1]));
  const sortiert = [...wartend, ...zeilen.filter((z) => z.zustand !== "wartet")];

  return (
    <section className={formular.gruppe} style={{ maxWidth: 940, marginTop: "2rem" }}>
      <h2 className={formular.gruppenTitel}>Warteliste</h2>
      <p className={formular.hinweis} style={{ fontSize: "var(--fs-body-s)" }}>
        <strong>{wartend.length}</strong> warten auf{" "}
        <strong>{wartend.reduce((s, z) => s + z.anzahl, 0)}</strong> Tickets ·{" "}
        <strong>{zaehle("angeboten") + zaehle("ueberweisung")}</strong> Angebote laufen ·{" "}
        <strong>{zaehle("gekauft")}</strong> gekauft · <strong>{zaehle("verfallen")}</strong>{" "}
        verfallen · <strong>{zaehle("unbestaetigt")}</strong> unbestätigt
      </p>
      <span className={formular.hinweis}>
        Wer wartet, bekommt freie Plätze automatisch, der Reihe nach: wenn eine Reservierung
        verfällt oder ihr hier ein Kontingent erhöht und speichert. Das Angebot hält 4 Stunden
        (nachts bis 10 Uhr), danach ist der Nächste dran. Passt die gewünschte Anzahl nicht,
        rückt der Nächste mit passender Anzahl vor.
      </span>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th className={css.zahl}>Nr.</th>
              <th>Gast</th>
              <th className={css.zahl}>Tickets</th>
              <th>Bestätigt</th>
              <th>Stand</th>
            </tr>
          </thead>
          <tbody>
            {sortiert.map((z) => (
              <tr key={z.id}>
                <td className={css.zahl}>{reihe.get(z.id) ?? "—"}</td>
                <td>
                  <div className={css.haupt}>{z.vorname ?? "—"}</div>
                  <div className={css.nebensache}>{z.email}</div>
                </td>
                <td className={css.zahl}>{z.anzahl}</td>
                <td>{z.bestaetigtAm ? zeit(z.bestaetigtAm) : "—"}</td>
                <td>
                  <span className={`${css.marke_} ${NAMEN[z.zustand][1]}`}>
                    {NAMEN[z.zustand][0]}
                  </span>
                  {z.zustand === "angeboten" && z.bestellung?.reserviert_bis ? (
                    <div className={css.nebensache}>bis {zeit(z.bestellung.reserviert_bis)}</div>
                  ) : null}
                  {z.bestellung && z.zustand !== "verfallen" ? (
                    <div className={css.nebensache}>{z.bestellung.nummer}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
