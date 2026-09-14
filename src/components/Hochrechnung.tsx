"use client";

import { useMemo, useState } from "react";
import type { HochEvent } from "@/lib/backoffice";
import bo from "@/app/[locale]/backoffice/backoffice.module.css";
import css from "./Hochrechnung.module.css";

/**
 * Was bringt ein Event, wenn alles verkauft wird — und woraus setzt sich
 * das zusammen?
 *
 * Bewusst ein Rechner und keine feste Zahl: Phasen ohne Kontingent haben
 * keine natürliche Obergrenze, Zahlungskosten hängen vom Anbieter ab, und
 * „alles verkauft" ist ein Szenario, keine Vorhersage. Deshalb lassen sich
 * Mengen, Auslastung und Kosten verstellen. Gespeichert wird nichts —
 * wer hier spielt, ändert kein Event.
 */

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const geld = (cent: number) => euro.format(cent / 100);

/** "1,5" oder "1.5" → 1.5; Unsinn → 0 */
function zahl(text: string): number {
  const wert = Number(text.replace(",", ".").trim());
  return Number.isFinite(wert) && wert >= 0 ? wert : 0;
}

type Einstellungen = {
  /** Mengen je Phase, als Text aus dem Eingabefeld. */
  mengen: Record<string, string>;
  fastlaneMenge: string;
  auslastung: number;
  prozent: string;
  fix: string;
  jeBestellung: string;
};

function start(ev: HochEvent): Einstellungen {
  const mengen: Record<string, string> = {};
  for (const p of ev.phasen) {
    // Unbegrenzte Phasen bekommen keine erfundene Zahl: Das Feld bleibt
    // leer und wird markiert, bis jemand eine Annahme einträgt.
    mengen[p.id] = p.kontingent === null ? "" : String(p.kontingent);
  }
  return {
    mengen,
    fastlaneMenge: ev.fastlane.kontingent === null ? "" : String(ev.fastlane.kontingent),
    auslastung: 100,
    // Richtwerte für Kartenzahlung in der EU; PayPal liegt höher.
    prozent: "1,5",
    fix: "0,25",
    jeBestellung: "2",
  };
}

export function Hochrechnung({ events }: { events: HochEvent[] }) {
  const vorwahl =
    events.find((e) => e.status === "veroeffentlicht" && new Date(e.beginn) > new Date()) ??
    events[0];
  const [eventId, setEventId] = useState(vorwahl?.id ?? "");
  const [alle, setAlle] = useState<Record<string, Einstellungen>>(() =>
    Object.fromEntries(events.map((e) => [e.id, start(e)])),
  );

  const ev = events.find((e) => e.id === eventId);
  const ein = ev ? alle[ev.id] : null;

  const setze = (teil: Partial<Einstellungen>) =>
    ev && setAlle((a) => ({ ...a, [ev.id]: { ...a[ev.id], ...teil } }));

  const r = useMemo(() => {
    if (!ev || !ein) return null;
    const faktor = ein.auslastung / 100;

    const zeilen = ev.phasen
      .filter((p) => p.art === "standard" && (p.aktiv || p.verkauft > 0))
      .map((p) => {
        const offen = p.kontingent === null && ein.mengen[p.id].trim() === "";
        const basis = zahl(ein.mengen[p.id]);
        // Schon verkaufte Tickets verschwinden nicht, nur weil jemand die
        // Auslastung herunterdreht.
        const menge = Math.max(p.verkauft, Math.round(basis * faktor));
        return {
          ...p,
          offen,
          menge,
          ticketsCent: menge * p.preisCent,
          gebuehrenCent: menge * p.gebuehrCent,
          bruttoCent: menge * (p.preisCent + p.gebuehrCent),
          erreichtCent: p.verkauft * (p.preisCent + p.gebuehrCent),
        };
      });

    const tickets = zeilen.reduce((s, z) => s + z.menge, 0);

    const fl = ev.fastlane;
    const flBasis = ein.fastlaneMenge.trim() === "" ? tickets : zahl(ein.fastlaneMenge);
    // Mehr Fast Lane als Tickets geht nicht — jedes Upgrade braucht einen Gast.
    const flMenge = fl.aktiv
      ? Math.min(tickets, Math.max(fl.verkauft, Math.round(flBasis * faktor)))
      : 0;
    const flCent = flMenge * fl.preisCent;

    const ticketsCent = zeilen.reduce((s, z) => s + z.ticketsCent, 0);
    const gebuehrenCent = zeilen.reduce((s, z) => s + z.gebuehrenCent, 0);
    const bruttoCent = ticketsCent + gebuehrenCent + flCent;

    const bestellungen = tickets > 0 ? Math.ceil(tickets / Math.max(1, zahl(ein.jeBestellung))) : 0;
    const zahlungCent = Math.round(
      bruttoCent * (zahl(ein.prozent) / 100) + bestellungen * zahl(ein.fix) * 100,
    );

    const erreichtCent =
      zeilen.reduce((s, z) => s + z.erreichtCent, 0) + fl.verkauft * fl.preisCent;

    return {
      zeilen,
      tickets,
      flMenge,
      flCent,
      ticketsCent,
      gebuehrenCent,
      bruttoCent,
      bestellungen,
      zahlungCent,
      nettoCent: bruttoCent - zahlungCent,
      erreichtCent,
      offenePhasen: zeilen.filter((z) => z.offen).length,
      vip: ev.phasen.filter((p) => p.art === "vip").length,
    };
  }, [ev, ein]);

  if (events.length === 0 || !ev || !ein || !r) {
    return <p className={bo.leer}>Noch keine Events angelegt.</p>;
  }

  const anteil = r.bruttoCent > 0 ? Math.round((r.erreichtCent / r.bruttoCent) * 100) : 0;

  return (
    <div className={css.rechner}>
      <div className={css.leiste}>
        <label className={css.feld}>
          <span className={css.beschriftung}>Event</span>
          <select
            className={css.eingabe}
            value={ev.id}
            onChange={(e) => setEventId(e.target.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.titel} ·{" "}
                {new Date(e.beginn).toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
                {e.status !== "veroeffentlicht" ? ` (${e.status})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className={`${css.feld} ${css.regler}`}>
          <span className={css.beschriftung}>
            Auslastung <strong>{ein.auslastung} %</strong>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={ein.auslastung}
            onChange={(e) => setze({ auslastung: Number(e.target.value) })}
          />
        </label>

        <button type="button" className={css.zurueck} onClick={() => setze(start(ev))}>
          Zurücksetzen
        </button>
      </div>

      <div className={bo.kennzahlen}>
        <Kachel name="Umsatz brutto" wert={geld(r.bruttoCent)} zusatz={`${r.tickets} Tickets`} />
        <Kachel
          name="davon Servicegebühren"
          wert={geld(r.gebuehrenCent)}
          zusatz={r.flCent > 0 ? `+ ${geld(r.flCent)} Fast Lane` : undefined}
        />
        <Kachel
          name="Zahlungskosten (geschätzt)"
          wert={`− ${geld(r.zahlungCent)}`}
          zusatz={`${r.bestellungen} Bestellungen`}
        />
        <Kachel name="Nach Zahlungskosten" wert={geld(r.nettoCent)} betont />
      </div>

      {r.offenePhasen > 0 ? (
        <p className={css.hinweis}>
          <strong>
            {r.offenePhasen === 1 ? "Eine Phase hat" : `${r.offenePhasen} Phasen haben`} kein
            Kontingent.
          </strong>{" "}
          Dort gibt es kein „ausverkauft" — trag eine Menge ein, mit der du rechnen
          willst. Bis dahin zählt nur, was schon verkauft ist.
        </p>
      ) : null}

      <div className={bo.tabellenfeld}>
        <table className={bo.tabelle}>
          <thead>
            <tr>
              <th>Phase</th>
              <th className={bo.zahl}>Menge</th>
              <th className={bo.zahl}>Preis</th>
              <th className={bo.zahl}>Gebühr</th>
              <th className={bo.zahl}>Tickets</th>
              <th className={bo.zahl}>Gebühren</th>
              <th className={bo.zahl}>Brutto</th>
              <th className={bo.zahl}>Verkauft</th>
            </tr>
          </thead>
          <tbody>
            {r.zeilen.map((z) => (
              <tr key={z.id} className={z.offen ? css.offen : undefined}>
                <td className={bo.haupt}>
                  {z.name}
                  {!z.aktiv ? <div className={bo.nebensache}>stillgelegt</div> : null}
                </td>
                <td className={bo.zahl}>
                  <input
                    className={`${css.menge} ${z.offen ? css.mengeOffen : ""}`}
                    inputMode="numeric"
                    placeholder={z.kontingent === null ? "unbegrenzt" : undefined}
                    value={ein.mengen[z.id]}
                    aria-label={`Menge ${z.name}`}
                    onChange={(e) =>
                      setze({ mengen: { ...ein.mengen, [z.id]: e.target.value } })
                    }
                  />
                  {ein.auslastung < 100 || z.menge !== zahl(ein.mengen[z.id]) ? (
                    <div className={bo.nebensache}>gerechnet: {z.menge}</div>
                  ) : null}
                </td>
                <td className={bo.zahl}>{geld(z.preisCent)}</td>
                <td className={bo.zahl}>{geld(z.gebuehrCent)}</td>
                <td className={bo.zahl}>{geld(z.ticketsCent)}</td>
                <td className={bo.zahl}>{geld(z.gebuehrenCent)}</td>
                <td className={`${bo.zahl} ${bo.haupt}`}>{geld(z.bruttoCent)}</td>
                <td className={bo.zahl}>
                  {z.verkauft}
                  {z.kontingent !== null ? ` / ${z.kontingent}` : ""}
                </td>
              </tr>
            ))}

            {ev.fastlane.aktiv ? (
              <tr>
                <td className={bo.haupt}>
                  Fast Lane
                  <div className={bo.nebensache}>Upgrade, höchstens eins je Ticket</div>
                </td>
                <td className={bo.zahl}>
                  <input
                    className={css.menge}
                    inputMode="numeric"
                    placeholder="alle"
                    value={ein.fastlaneMenge}
                    aria-label="Menge Fast Lane"
                    onChange={(e) => setze({ fastlaneMenge: e.target.value })}
                  />
                  <div className={bo.nebensache}>gerechnet: {r.flMenge}</div>
                </td>
                <td className={bo.zahl}>{geld(ev.fastlane.preisCent)}</td>
                <td className={bo.zahl}>—</td>
                <td className={bo.zahl}>—</td>
                <td className={bo.zahl}>—</td>
                <td className={`${bo.zahl} ${bo.haupt}`}>{geld(r.flCent)}</td>
                <td className={bo.zahl}>
                  {ev.fastlane.verkauft}
                  {ev.fastlane.kontingent !== null ? ` / ${ev.fastlane.kontingent}` : ""}
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className={css.summe}>
              <td>Summe</td>
              <td className={bo.zahl}>{r.tickets}</td>
              <td />
              <td />
              <td className={bo.zahl}>{geld(r.ticketsCent)}</td>
              <td className={bo.zahl}>{geld(r.gebuehrenCent)}</td>
              <td className={bo.zahl}>{geld(r.bruttoCent)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={css.unterteil}>
        <section className={css.kosten}>
          <h2 className={css.titel}>Zahlungskosten</h2>
          <div className={css.kostenfelder}>
            <label className={css.feld}>
              <span className={css.beschriftung}>Prozent vom Umsatz</span>
              <input
                className={css.eingabe}
                inputMode="decimal"
                value={ein.prozent}
                onChange={(e) => setze({ prozent: e.target.value })}
              />
            </label>
            <label className={css.feld}>
              <span className={css.beschriftung}>Fix je Bestellung (€)</span>
              <input
                className={css.eingabe}
                inputMode="decimal"
                value={ein.fix}
                onChange={(e) => setze({ fix: e.target.value })}
              />
            </label>
            <label className={css.feld}>
              <span className={css.beschriftung}>Ø Tickets je Bestellung</span>
              <input
                className={css.eingabe}
                inputMode="decimal"
                value={ein.jeBestellung}
                onChange={(e) => setze({ jeBestellung: e.target.value })}
              />
            </label>
          </div>
          <p className={bo.notiz}>
            Voreingestellt sind Richtwerte für Kartenzahlung in der EU (etwa
            1,5 % + 0,25 €). PayPal liegt eher bei 2,5–3 % + 0,35 €. Die echten
            Sätze stehen im jeweiligen Konto.
          </p>
        </section>

        <section className={css.kosten}>
          <h2 className={css.titel}>Bisher</h2>
          <div className={css.bisher}>
            <div>
              <span className={css.beschriftung}>Verkauft oder reserviert</span>
              <span className={css.bisherWert}>{geld(r.erreichtCent)}</span>
              <span className={bo.nebensache}>{anteil} % der Hochrechnung</span>
            </div>
            <div>
              <span className={css.beschriftung}>Tatsächlich bezahlt</span>
              <span className={css.bisherWert}>{geld(ev.bezahltCent)}</span>
            </div>
          </div>
          <span className={bo.balken} aria-hidden="true" style={{ width: "100%" }}>
            <span className={bo.balkenFuellung} style={{ width: `${Math.min(100, anteil)}%` }} />
          </span>
          <p className={bo.notiz}>
            „Verkauft" enthält laufende Reservierungen — sie blockieren Plätze,
            sind aber noch nicht bezahlt. Testkäufe ohne Zahlung zählen bei
            „bezahlt" mit.
            {r.vip > 0 ? " VIP-Tische sind nicht eingerechnet: Sie laufen über Anfragen mit individuellem Preis." : ""}
          </p>
        </section>
      </div>
    </div>
  );
}

function Kachel({
  name,
  wert,
  zusatz,
  betont = false,
}: {
  name: string;
  wert: string;
  zusatz?: string;
  betont?: boolean;
}) {
  return (
    <div className={`${bo.kachel} ${betont ? css.betont : ""}`}>
      <span className={bo.kachelName}>{name}</span>
      <span className={bo.kachelWert}>{wert}</span>
      {zusatz ? <span className={bo.kachelZusatz}>{zusatz}</span> : null}
    </div>
  );
}
