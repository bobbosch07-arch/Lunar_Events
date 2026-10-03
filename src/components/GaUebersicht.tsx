import { Link } from "@/i18n/navigation";
import { holeGaUebersicht, TRICHTER } from "@/lib/ga-daten";
import { holeAuswertung } from "@/lib/backoffice";
import { preisText } from "@/lib/format";
import bo from "@/app/[locale]/backoffice/backoffice.module.css";
import css from "./GaUebersicht.module.css";

export const GA_ZEITRAEUME = [7, 28, 90] as const;

const SCHRITTE: Record<(typeof TRICHTER)[number], string> = {
  view_item: "Event angesehen",
  add_to_cart: "Ticket gewählt",
  begin_checkout: "Kasse geöffnet",
  add_shipping_info: "Daten eingegeben",
  purchase: "Gekauft",
};

const GERAETE: Record<string, string> = { mobile: "Handy", desktop: "Rechner", tablet: "Tablet" };

const ganz = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
const prozent = (teil: number, ganzes: number) =>
  ganzes > 0 ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format((teil / ganzes) * 100)} %` : "—";
const dauer = (sek: number) => `${Math.floor(sek / 60)}:${String(Math.round(sek % 60)).padStart(2, "0")} min`;
const euro = (wert: number) => preisText(Math.round(wert * 100), "de");

function tagAus(gaTag: string): Date {
  return new Date(`${gaTag.slice(0, 4)}-${gaTag.slice(4, 6)}-${gaTag.slice(6, 8)}T12:00:00`);
}

/** Besucher je Tag als schlichte Balken. Keine Diagramm-Bibliothek. */
function Verlauf({ tage }: { tage: Array<{ tag: string; besucher: number }> }) {
  if (tage.length === 0) return null;
  const hoechst = Math.max(1, ...tage.map((t) => t.besucher));
  const breite = 100 / tage.length;
  const datum = (t: string) =>
    new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" }).format(tagAus(t));
  return (
    <figure className={css.verlauf}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Besucher je Tag">
        {tage.map((t, i) => {
          const h = (t.besucher / hoechst) * 38;
          return (
            <rect
              key={t.tag}
              x={i * breite + breite * 0.15}
              y={40 - h}
              width={breite * 0.7}
              height={Math.max(h, 0.4)}
              className={css.balken}
            >
              <title>{`${datum(t.tag)}: ${t.besucher} Besucher`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className={css.achse}>
        <span>{datum(tage[0].tag)}</span>
        <span>höchstens {ganz(hoechst)} am Tag</span>
        <span>{datum(tage[tage.length - 1].tag)}</span>
      </figcaption>
    </figure>
  );
}

function Tabelle({
  kopf,
  zeilen,
  leer,
}: {
  kopf: Array<{ name: string; zahl?: boolean }>;
  zeilen: Array<Array<string | number>>;
  leer: string;
}) {
  return (
    <div className={bo.tabellenfeld}>
      <table className={bo.tabelle}>
        <thead>
          <tr>
            {kopf.map((k) => (
              <th key={k.name} className={k.zahl ? bo.zahl : undefined}>
                {k.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {zeilen.length === 0 ? (
            <tr>
              <td colSpan={kopf.length} className={bo.leer}>
                {leer}
              </td>
            </tr>
          ) : (
            zeilen.map((z, i) => (
              <tr key={i}>
                {z.map((wert, j) => (
                  <td key={j} className={j === 0 ? bo.haupt : kopf[j]?.zahl ? bo.zahl : bo.nebensache}>
                    {typeof wert === "number" ? ganz(wert) : wert}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Titel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className={bo.seitentitel} style={{ fontSize: "1.05rem", marginTop: "2rem" }}>
      {children}
    </h3>
  );
}

/**
 * GA4 im Backoffice. Zeigt nur, wer im Banner zugestimmt hat; dafür
 * Personen statt Aufrufe, Wege und Klicks. Die eigene Zählung darüber
 * bleibt die vollständige Zahl.
 */
export async function GaUebersicht({ tage }: { tage: number }) {
  const [ergebnis, eigene] = await Promise.all([holeGaUebersicht(tage), holeAuswertung(tage)]);

  if (!ergebnis.ok && ergebnis.grund === "nicht_eingerichtet") {
    return (
      <div className={css.hinweis}>
        <strong>Noch nicht angebunden.</strong> Für diese Übersicht braucht das
        Backoffice Lesezugriff auf GA4: <code>GA_PROPERTY_ID</code> (die Zahl
        unter Verwaltung → Property-Details) und <code>GA_DIENSTKONTO_JSON</code>{" "}
        (Schlüsseldatei eines Google-Dienstkontos, das in GA4 als „Betrachter“
        eingetragen ist) in Vercel. Wie das geht, steht in CLAUDE.md unter
        „GA4 im Backoffice“.
      </div>
    );
  }
  if (!ergebnis.ok) {
    return (
      <div className={`${css.hinweis} ${css.fehler}`}>
        <strong>Google antwortet nicht wie erwartet.</strong> {ergebnis.meldung}
      </div>
    );
  }

  const d = ergebnis.daten;
  const k = d.kennzahlen;
  const eigeneAufrufe = eigene.reduce((s, z) => s + z.gesehen, 0);
  const ersterSchritt = d.trichter.view_item ?? 0;
  const geraeteGesamt = d.geraete.reduce((s, g) => s + g.besucher, 0);

  const kacheln: Array<[string, string, string]> = [
    ["Besucher", ganz(k.besucher), `davon neu: ${ganz(k.neu)}`],
    ["Besuche", ganz(k.sitzungen), `Ø ${dauer(k.dauerSek)} · ${prozent(k.engagement, 1)} aktiv`],
    ["Seitenaufrufe", ganz(k.aufrufe), `${k.besucher > 0 ? (k.aufrufe / k.besucher).toFixed(1).replace(".", ",") : "—"} je Besucher`],
    ["Käufe", ganz(k.kaeufe), `${euro(k.umsatz)} · ${prozent(k.kaeufe, k.besucher)} der Besucher`],
  ];

  return (
    <>
      {d.jetzt !== null ? (
        <p className={css.jetzt}>
          <span className={css.punkt} aria-hidden="true" />
          Gerade auf der Seite: <strong>{ganz(d.jetzt)}</strong>
          <span className={css.klein}> (letzte 30 Minuten, nur mit Zustimmung)</span>
        </p>
      ) : null}

      <div className={bo.kennzahlen}>
        {kacheln.map(([name, wert, zusatz]) => (
          <div key={name} className={bo.kachel}>
            <span className={bo.kachelName}>{name}</span>
            <span className={bo.kachelWert}>{wert}</span>
            <span className={bo.kachelZusatz}>{zusatz}</span>
          </div>
        ))}
      </div>

      <Titel>Besucher je Tag</Titel>
      <Verlauf tage={d.verlauf} />

      <Titel>Weg zum Kauf (Personen)</Titel>
      <div className={bo.tabellenfeld}>
        <table className={bo.tabelle}>
          <thead>
            <tr>
              <th>Schritt</th>
              <th className={bo.zahl}>Personen</th>
              <th className={bo.zahl}>vom ersten Schritt</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {TRICHTER.map((schritt) => {
              const wert = d.trichter[schritt] ?? 0;
              const anteil = ersterSchritt > 0 ? (wert / ersterSchritt) * 100 : 0;
              return (
                <tr key={schritt}>
                  <td className={bo.haupt}>{SCHRITTE[schritt]}</td>
                  <td className={bo.zahl}>{ganz(wert)}</td>
                  <td className={bo.zahl}>{prozent(wert, ersterSchritt)}</td>
                  <td>
                    <span className={bo.balken} aria-hidden="true">
                      <span className={bo.balkenFuellung} style={{ width: `${Math.min(100, anteil)}%` }} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Titel>Je Event</Titel>
      <Tabelle
        kopf={[
          { name: "Event" },
          { name: "Angesehen", zahl: true },
          { name: "Ticket gewählt", zahl: true },
          { name: "Gekauft", zahl: true },
          { name: "Umsatz", zahl: true },
        ]}
        zeilen={d.events.map((e) => [e.name, e.gesehen, e.gewaehlt, e.gekauft, euro(e.umsatz)])}
        leer="Noch keine Event-Aufrufe in GA4."
      />

      <Titel>Woher die Besucher kommen</Titel>
      <Tabelle
        kopf={[
          { name: "Quelle / Medium" },
          { name: "Besuche", zahl: true },
          { name: "Besucher", zahl: true },
          { name: "Käufe", zahl: true },
        ]}
        zeilen={d.quellen.map((q) => [q.name, q.sitzungen, q.besucher, q.kaeufe])}
        leer="Noch keine Besuche erfasst."
      />

      {d.kampagnen.length > 0 ? (
        <>
          <Titel>Kampagnen (utm_campaign)</Titel>
          <Tabelle
            kopf={[{ name: "Kampagne" }, { name: "Besuche", zahl: true }, { name: "Käufe", zahl: true }]}
            zeilen={d.kampagnen.map((c) => [c.name, c.sitzungen, c.kaeufe])}
            leer=""
          />
        </>
      ) : null}

      <Titel>Klicks auf Knöpfe</Titel>
      {d.klicks === null ? (
        <p className={bo.notiz} style={{ marginTop: 0 }}>
          Für diese Liste braucht GA4 eine eigene Dimension: Verwaltung →
          Benutzerdefinierte Definitionen → „Benutzerdefinierte Dimension
          erstellen“, Name „Klickziel“, Bereich „Ereignis“, Ereignisparameter{" "}
          <code>ziel</code>. Danach füllt sie sich mit neuen Klicks.
        </p>
      ) : (
        <Tabelle
          kopf={[{ name: "Knopf" }, { name: "Klicks", zahl: true }]}
          zeilen={d.klicks.map((c) => [c.ziel, c.anzahl])}
          leer="Noch keine Klicks erfasst."
        />
      )}

      <Titel>Meistbesuchte Seiten</Titel>
      <Tabelle
        kopf={[{ name: "Seite" }, { name: "Aufrufe", zahl: true }, { name: "Besucher", zahl: true }]}
        zeilen={d.seiten.map((s) => [s.pfad, s.aufrufe, s.besucher])}
        leer="Noch keine Aufrufe."
      />

      <div className={css.zweispaltig}>
        <div>
          <Titel>Geräte</Titel>
          <Tabelle
            kopf={[{ name: "Gerät" }, { name: "Besucher", zahl: true }, { name: "Anteil", zahl: true }]}
            zeilen={d.geraete.map((g) => [GERAETE[g.name] ?? g.name, g.besucher, prozent(g.besucher, geraeteGesamt)])}
            leer="—"
          />
        </div>
        <div>
          <Titel>Städte</Titel>
          <Tabelle
            kopf={[{ name: "Stadt" }, { name: "Besucher", zahl: true }]}
            zeilen={d.staedte.map((s) => [s.name, s.besucher])}
            leer="—"
          />
        </div>
      </div>

      <p className={bo.notiz}>
        GA4 sieht nur, wer im Cookie-Banner zugestimmt hat
        {eigeneAufrufe > 0 ? (
          <>
            : Von {ganz(eigeneAufrufe)} Event-Aufrufen der eigenen Zählung hat GA4{" "}
            {ganz(d.eventAufrufe)} gesehen, also etwa {prozent(d.eventAufrufe, eigeneAufrufe)}.
            Das ist grob der Anteil, der zustimmt
          </>
        ) : null}
        . Dafür zählt GA4 Personen statt Aufrufe und erkennt sie beim nächsten
        Besuch wieder. Die Zahlen kommen mit einigen Stunden Verzögerung; nur
        „Gerade auf der Seite“ ist sofort. Adressen mit Zugang (Ticketseite,
        Abmeldelinks) stehen dort als <code>…/_</code>.{" "}
        Abgerufen{" "}
        {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(
          new Date(ergebnis.abgerufen),
        )}{" "}
        Uhr, höchstens alle fünf Minuten neu.
      </p>
    </>
  );
}

/** Umschalter für den Zeitraum, über die Adresse (?ga=28). */
export function GaZeitraum({ tage }: { tage: number }) {
  return (
    <nav className={css.zeitraum} aria-label="Zeitraum">
      {GA_ZEITRAEUME.map((t) => (
        <Link
          key={t}
          href={`/backoffice/auswertung?ga=${t}`}
          className={`${css.zeitraumPunkt} ${t === tage ? css.zeitraumAktiv : ""}`}
          aria-current={t === tage ? "page" : undefined}
          scroll={false}
        >
          {t} Tage
        </Link>
      ))}
    </nav>
  );
}
