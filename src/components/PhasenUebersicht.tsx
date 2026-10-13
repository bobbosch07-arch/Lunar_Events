"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import {
  oeffnePhase,
  schliessePhase,
  setzeKontingent,
  speicherePhase,
  verschiebeTickets,
} from "@/app/aktionen/kontingente";
import fo from "./EventFormular.module.css";
import bo from "@/app/[locale]/backoffice/backoffice.module.css";
import css from "./PhasenUebersicht.module.css";

export type PhaseZeile = {
  id: string;
  name: string;
  art: "standard" | "vip";
  preis_cent: number;
  gebuehr_cent: number;
  /** null = unbegrenzt */
  kontingent: number | null;
  /** Zähler der Datenbank: bezahlt plus offene Reservierungen. */
  verkauft: number;
  bezahlt: number;
  reserviert: number;
  aktiv: boolean;
  abendkasse: boolean;
  leistungen: string[];
  beschreibung: string | null;
  /** Was die Kasse gerade zeigt: läuft, folgt, ausverkauft … */
  stand: { text: string; ton: "gut" | "warte" | "neutral" | "schlecht" };
};

type Panel =
  | { art: "kontingent"; id: string }
  | { art: "verschieben"; id: string }
  | { art: "schliessen"; id: string }
  | { art: "bearbeiten"; id: string }
  | { art: "neu" };

const euro = (cent: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cent / 100);
const euroFeld = (cent: number) => (cent / 100).toFixed(2).replace(".", ",");
function centAus(text: string): number {
  const zahl = Number(text.replace(",", ".").trim());
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : NaN;
}
const frei = (p: PhaseZeile) => (p.kontingent === null ? null : Math.max(0, p.kontingent - p.verkauft));

/** Eine Leiste: bezahlt, reserviert, frei. Ohne Kontingent nur Zahlen. */
function Leiste({ bezahlt, reserviert, gesamt, gross = false }: {
  bezahlt: number;
  reserviert: number;
  gesamt: number;
  gross?: boolean;
}) {
  const teil = (n: number) => `${gesamt > 0 ? Math.min(100, (n / gesamt) * 100) : 0}%`;
  return (
    <div
      className={`${css.leiste} ${gross ? css.leisteGross : ""}`}
      role="img"
      aria-label={`${bezahlt} bezahlt, ${reserviert} reserviert, ${Math.max(0, gesamt - bezahlt - reserviert)} frei von ${gesamt}`}
    >
      <span className={css.bezahlt} style={{ width: teil(bezahlt) }} />
      <span className={css.reserviert} style={{ width: teil(reserviert) }} />
    </div>
  );
}

/**
 * Ticketphasen in der Event-Übersicht (13.10.2026): jede Phase mit eigener
 * Leiste, und die Kontingent-Schritte einzeln. Jeder Schritt läuft in der
 * Datenbank unter Sperre (0044), danach kommt die Warteliste zuerst dran.
 */
export function PhasenUebersicht({ eventId, phasen }: { eventId: string; phasen: PhaseZeile[] }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [laeuft, starte] = useTransition();

  // Felder der offenen Panels
  const [zahl, setZahl] = useState("");
  const [ziel, setZiel] = useState("");
  const [verteilung, setVerteilung] = useState<Record<string, string>>({});
  const [details, setDetails] = useState({
    name: "", art: "standard" as "standard" | "vip", preis: "", gebuehr: "", kontingent: "",
    leistungen: "", beschreibung: "", abendkasse: false,
  });

  const mitKontingent = phasen.filter((p) => p.art === "standard" && p.kontingent !== null);
  const gesamt = mitKontingent.reduce((s, p) => s + (p.kontingent ?? 0), 0);
  const bezahlt = mitKontingent.reduce((s, p) => s + p.bezahlt, 0);
  const reserviert = mitKontingent.reduce((s, p) => s + p.reserviert, 0);
  const belegt = mitKontingent.reduce((s, p) => s + p.verkauft, 0);
  const unbegrenzt = phasen.filter((p) => p.art === "standard" && p.kontingent === null);

  function oeffne(p: Panel) {
    setMeldung(null);
    setPanel(p);
    if (p.art === "kontingent") {
      setZahl(String(phasen.find((x) => x.id === p.id)?.kontingent ?? ""));
    } else if (p.art === "verschieben") {
      setZahl("");
      setZiel("");
    } else if (p.art === "schliessen") {
      setVerteilung({});
    } else if (p.art === "bearbeiten") {
      const x = phasen.find((y) => y.id === p.id)!;
      setDetails({
        name: x.name, art: x.art, preis: euroFeld(x.preis_cent), gebuehr: euroFeld(x.gebuehr_cent),
        kontingent: "", leistungen: x.leistungen.join("\n"), beschreibung: x.beschreibung ?? "",
        abendkasse: x.abendkasse,
      });
    } else {
      setDetails({ name: "", art: "standard", preis: "", gebuehr: "", kontingent: "", leistungen: "", beschreibung: "", abendkasse: false });
    }
  }

  function fuehreAus(aufgabe: () => Promise<{ ok: true } | { ok: false; fehler: string }>, erfolg: string) {
    starte(async () => {
      const antwort = await aufgabe();
      if (!antwort.ok) {
        setMeldung({ text: antwort.fehler, fehler: true });
        return;
      }
      setMeldung({ text: erfolg, fehler: false });
      setPanel(null);
      router.refresh();
    });
  }

  // Ziele zum Verteilen: andere Standardphasen mit Kontingent
  const zieleFuer = (id: string) =>
    phasen.filter((p) => p.id !== id && p.art === "standard" && p.kontingent !== null);

  return (
    <section className={fo.gruppe} style={{ maxWidth: 940 }}>
      <h2 className={fo.gruppenTitel}>Tickets und Kontingente</h2>

      {/* ---------- Gesamt ---------- */}
      <div className={css.gesamt}>
        <div className={css.gesamtZahlen}>
          <span className={css.gross}>{bezahlt}</span>
          <span className={css.von}>von {gesamt} bezahlt</span>
        </div>
        <Leiste bezahlt={bezahlt} reserviert={reserviert} gesamt={gesamt} gross />
        <p className={css.legende}>
          <span className={css.punktBezahlt} /> {bezahlt} bezahlt
          <span className={css.punktReserviert} /> {reserviert} reserviert
          <span className={css.punktFrei} /> {Math.max(0, gesamt - belegt)} frei
          {unbegrenzt.length > 0 ? ` · dazu ${unbegrenzt.map((p) => p.name).join(", ")} ohne Kontingent` : ""}
        </p>
      </div>

      {meldung ? (
        <p className={meldung.fehler ? fo.stoerung : fo.erfolg} role="status">
          {meldung.text}
        </p>
      ) : null}

      {/* ---------- Je Phase ---------- */}
      {phasen.map((p) => {
        const f = frei(p);
        const offen = panel && "id" in panel && panel.id === p.id ? panel.art : null;
        const ziele = zieleFuer(p.id);
        const summe = Object.values(verteilung).reduce((s, v) => s + (Number(v) || 0), 0);
        return (
          <div key={p.id} className={`${css.phase} ${p.aktiv ? "" : css.geschlossen}`}>
            <div className={css.kopf}>
              <div>
                <span className={css.name}>{p.name}</span>
                <span className={css.preis}>
                  {p.art === "vip" ? "VIP, auf Anfrage" : `${euro(p.preis_cent)} + ${euro(p.gebuehr_cent)} Gebühr`}
                  {p.abendkasse ? " · nur Abendkasse" : ""}
                </span>
              </div>
              <span className={`${bo.marke_} ${bo[p.stand.ton]}`}>{p.stand.text}</span>
            </div>

            {p.kontingent !== null ? (
              <>
                <Leiste bezahlt={p.bezahlt} reserviert={p.reserviert} gesamt={p.kontingent} />
                <p className={css.zahlen}>
                  <strong>{p.bezahlt}</strong> bezahlt · {p.reserviert} reserviert · <strong>{f}</strong> frei
                  <span className={css.vonKlein}> von {p.kontingent}</span>
                  {!p.aktiv && (f ?? 0) > 0 ? (
                    <span className={css.hinweisFrei}> · {f} wieder frei geworden, zum Verteilen</span>
                  ) : null}
                </p>
              </>
            ) : (
              <p className={css.zahlen}>
                <strong>{p.bezahlt}</strong> bezahlt · {p.reserviert} reserviert · ohne Kontingent
              </p>
            )}

            <div className={css.aktionen}>
              {p.kontingent !== null && p.art === "standard" ? (
                <>
                  <button type="button" className={bo.textknopf} onClick={() => oeffne({ art: "kontingent", id: p.id })}>
                    Kontingent ändern
                  </button>
                  {(f ?? 0) > 0 && ziele.length > 0 ? (
                    <button type="button" className={bo.textknopf} onClick={() => oeffne({ art: "verschieben", id: p.id })}>
                      Tickets verschieben
                    </button>
                  ) : null}
                </>
              ) : null}
              {p.art === "standard" ? (
                p.aktiv ? (
                  <button type="button" className={bo.textknopf} onClick={() => oeffne({ art: "schliessen", id: p.id })}>
                    Phase schließen
                  </button>
                ) : (
                  <button
                    type="button"
                    className={bo.textknopf}
                    disabled={laeuft}
                    onClick={() => {
                      if (window.confirm(`„${p.name}“ wieder öffnen? Sie ist dann wieder kaufbar, sobald sie in der Reihe dran ist und Kontingent hat.`)) {
                        fuehreAus(() => oeffnePhase(p.id), `„${p.name}“ ist wieder offen.`);
                      }
                    }}
                  >
                    Wieder öffnen
                  </button>
                )
              ) : null}
              <button type="button" className={bo.textknopf} onClick={() => oeffne({ art: "bearbeiten", id: p.id })}>
                Bearbeiten
              </button>
            </div>

            {/* ---------- Panels ---------- */}
            {offen === "kontingent" ? (
              <div className={css.panel}>
                <div className={fo.feld} style={{ maxWidth: 200 }}>
                  <label className={fo.beschriftung} htmlFor={`k-${p.id}`}>
                    Neues Kontingent
                  </label>
                  <input id={`k-${p.id}`} className={fo.eingabe} inputMode="numeric" value={zahl} onChange={(e) => setZahl(e.target.value)} />
                  <span className={fo.hinweis}>Mindestens {p.verkauft} (bezahlt und reserviert).</span>
                </div>
                <div className={css.knoepfe}>
                  <Knopf groesse="klein" disabled={laeuft} onClick={() => fuehreAus(() => setzeKontingent(p.id, Number(zahl)), `Kontingent von „${p.name}“ ist jetzt ${zahl}.`)}>
                    Speichern
                  </Knopf>
                  <Knopf stil="linie" groesse="klein" onClick={() => setPanel(null)}>Abbrechen</Knopf>
                </div>
              </div>
            ) : null}

            {offen === "verschieben" ? (
              <div className={css.panel}>
                <div className={fo.raster}>
                  <div className={fo.feld}>
                    <label className={fo.beschriftung} htmlFor={`z-${p.id}`}>Nach</label>
                    <select id={`z-${p.id}`} className={fo.auswahl} value={ziel} onChange={(e) => setZiel(e.target.value)}>
                      <option value="">Phase wählen</option>
                      {ziele.map((z) => (
                        <option key={z.id} value={z.id}>{z.name} (jetzt {z.kontingent})</option>
                      ))}
                    </select>
                  </div>
                  <div className={fo.feld}>
                    <label className={fo.beschriftung} htmlFor={`m-${p.id}`}>Tickets</label>
                    <input id={`m-${p.id}`} className={fo.eingabe} inputMode="numeric" placeholder={`höchstens ${f}`} value={zahl} onChange={(e) => setZahl(e.target.value)} />
                  </div>
                </div>
                <div className={css.knoepfe}>
                  <Knopf
                    groesse="klein"
                    disabled={laeuft || !ziel || !zahl}
                    onClick={() => fuehreAus(() => verschiebeTickets(p.id, ziel, Number(zahl)), `${zahl} Tickets von „${p.name}“ verschoben.`)}
                  >
                    Verschieben
                  </Knopf>
                  <Knopf stil="linie" groesse="klein" onClick={() => setPanel(null)}>Abbrechen</Knopf>
                </div>
              </div>
            ) : null}

            {offen === "schliessen" ? (
              <div className={css.panel}>
                <p className={fo.hinweis} style={{ fontSize: "inherit" }}>
                  <strong>„{p.name}“ schließen.</strong> Sie nimmt dann keine Käufe mehr an, und die
                  nächste Phase in der Reihe geht auf. {p.verkauft} Tickets sind bezahlt oder
                  reserviert und bleiben gültig.
                  {f ? ` ${f} sind frei. Verteile sie hier, was übrig bleibt, fällt weg.` : ""}
                </p>
                {f && ziele.length > 0 ? (
                  <div className={fo.raster}>
                    {ziele.map((z) => (
                      <div key={z.id} className={fo.feld}>
                        <label className={fo.beschriftung} htmlFor={`v-${p.id}-${z.id}`}>
                          + nach {z.name}
                        </label>
                        <input
                          id={`v-${p.id}-${z.id}`}
                          className={fo.eingabe}
                          inputMode="numeric"
                          placeholder="0"
                          value={verteilung[z.id] ?? ""}
                          onChange={(e) => setVerteilung((alt) => ({ ...alt, [z.id]: e.target.value }))}
                        />
                        <span className={fo.hinweis}>jetzt {z.kontingent}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {f ? (
                  <p className={summe > f ? fo.stoerung : fo.hinweis}>
                    {summe > f
                      ? `Das sind ${summe}, frei sind nur ${f}.`
                      : `Verteilt: ${summe} · fällt weg: ${f - summe}`}
                  </p>
                ) : null}
                <div className={css.knoepfe}>
                  <Knopf
                    groesse="klein"
                    disabled={laeuft || summe > (f ?? 0)}
                    onClick={() => {
                      if (!window.confirm(`„${p.name}“ jetzt schließen?`)) return;
                      fuehreAus(
                        () => schliessePhase(p.id, Object.entries(verteilung).map(([phaseId, v]) => ({ phaseId, menge: Number(v) || 0 }))),
                        `„${p.name}“ ist geschlossen.${summe ? ` ${summe} Tickets verteilt.` : ""}`,
                      );
                    }}
                  >
                    Phase schließen
                  </Knopf>
                  <Knopf stil="linie" groesse="klein" onClick={() => setPanel(null)}>Abbrechen</Knopf>
                </div>
              </div>
            ) : null}

            {offen === "bearbeiten" ? (
              <PhasenFormular
                details={details}
                setDetails={setDetails}
                laeuft={laeuft}
                neu={false}
                onAbbrechen={() => setPanel(null)}
                onSpeichern={() =>
                  fuehreAus(
                    () =>
                      speicherePhase({
                        id: p.id, eventId, name: details.name, art: p.art,
                        preis_cent: centAus(details.preis || "0"), gebuehr_cent: centAus(details.gebuehr || "0"),
                        leistungen: details.leistungen.split("\n"), beschreibung: details.beschreibung || null,
                        abendkasse: details.abendkasse,
                      }),
                    `„${details.name}“ gespeichert.`,
                  )
                }
              />
            ) : null}
          </div>
        );
      })}

      {panel?.art === "neu" ? (
        <div className={css.phase}>
          <PhasenFormular
            details={details}
            setDetails={setDetails}
            laeuft={laeuft}
            neu
            onAbbrechen={() => setPanel(null)}
            onSpeichern={() =>
              fuehreAus(
                () =>
                  speicherePhase({
                    eventId, name: details.name, art: details.art,
                    preis_cent: centAus(details.preis || "0"), gebuehr_cent: centAus(details.gebuehr || "0"),
                    kontingent: details.kontingent.trim() === "" ? null : Number(details.kontingent),
                    leistungen: details.leistungen.split("\n"), beschreibung: details.beschreibung || null,
                    abendkasse: details.abendkasse,
                  }),
                `Phase „${details.name}“ angelegt.`,
              )
            }
          />
        </div>
      ) : (
        <div>
          <Knopf stil="linie" groesse="klein" onClick={() => oeffne({ art: "neu" })}>
            Phase hinzufügen
          </Knopf>
        </div>
      )}

      <p className={fo.hinweis}>
        Die Phasen laufen der Reihe nach: Eine spätere geht erst auf, wenn alle früheren offenen
        ausverkauft oder geschlossen sind. „Reserviert“ sind Tickets, die gerade jemand in der Kasse
        hält (15 Minuten) oder per Überweisung bestellt hat.
      </p>
    </section>
  );
}

type Details = {
  name: string; art: "standard" | "vip"; preis: string; gebuehr: string; kontingent: string;
  leistungen: string; beschreibung: string; abendkasse: boolean;
};

function PhasenFormular({
  details,
  setDetails,
  laeuft,
  neu,
  onAbbrechen,
  onSpeichern,
}: {
  details: Details;
  setDetails: (d: Details) => void;
  laeuft: boolean;
  neu: boolean;
  onAbbrechen: () => void;
  onSpeichern: () => void;
}) {
  const setze = <K extends keyof Details>(k: K, v: Details[K]) => setDetails({ ...details, [k]: v });
  return (
    <div className={css.panel}>
      <div className={fo.raster}>
        <div className={fo.feld}>
          <label className={fo.beschriftung} htmlFor="ph-name">Name</label>
          <input id="ph-name" className={fo.eingabe} maxLength={80} value={details.name} onChange={(e) => setze("name", e.target.value)} />
        </div>
        {neu ? (
          <div className={fo.feld}>
            <label className={fo.beschriftung} htmlFor="ph-art">Art</label>
            <select id="ph-art" className={fo.auswahl} value={details.art} onChange={(e) => setze("art", e.target.value as Details["art"])}>
              <option value="standard">Ticket</option>
              <option value="vip">VIP (auf Anfrage)</option>
            </select>
          </div>
        ) : null}
        {details.art === "standard" ? (
          <>
            <div className={fo.feld}>
              <label className={fo.beschriftung} htmlFor="ph-preis">Preis in €</label>
              <input id="ph-preis" className={fo.eingabe} inputMode="decimal" placeholder="9,99" value={details.preis} onChange={(e) => setze("preis", e.target.value)} />
            </div>
            <div className={fo.feld}>
              <label className={fo.beschriftung} htmlFor="ph-gebuehr">Gebühr in €</label>
              <input id="ph-gebuehr" className={fo.eingabe} inputMode="decimal" placeholder="1,00" value={details.gebuehr} onChange={(e) => setze("gebuehr", e.target.value)} />
            </div>
          </>
        ) : null}
        {neu && details.art === "standard" ? (
          <div className={fo.feld}>
            <label className={fo.beschriftung} htmlFor="ph-kont">Kontingent</label>
            <input id="ph-kont" className={fo.eingabe} inputMode="numeric" placeholder="leer = unbegrenzt" value={details.kontingent} onChange={(e) => setze("kontingent", e.target.value)} />
          </div>
        ) : null}
      </div>
      <div className={fo.feld}>
        <label className={fo.beschriftung} htmlFor="ph-leist">Leistungen (eine je Zeile)</label>
        <textarea id="ph-leist" className={fo.textfeld} rows={3} value={details.leistungen} onChange={(e) => setze("leistungen", e.target.value)} />
      </div>
      <div className={fo.feld}>
        <label className={fo.beschriftung} htmlFor="ph-beschr">Beschreibung</label>
        <input id="ph-beschr" className={fo.eingabe} value={details.beschreibung} onChange={(e) => setze("beschreibung", e.target.value)} />
      </div>
      <label className={fo.schalter}>
        <input type="checkbox" checked={details.abendkasse} onChange={(e) => setze("abendkasse", e.target.checked)} />
        Nur an der Abendkasse (online unsichtbar)
      </label>
      {!neu ? (
        <span className={fo.hinweis}>
          Preisänderungen gelten für neue Käufe; bezahlte Bestellungen behalten ihren Preis.
          Kontingent und offen/zu stehen oben an der Phase.
        </span>
      ) : (
        <span className={fo.hinweis}>Neue Phasen kommen hinten in die Reihe.</span>
      )}
      <div className={css.knoepfe}>
        <Knopf groesse="klein" disabled={laeuft || !details.name.trim()} onClick={onSpeichern}>
          {neu ? "Phase anlegen" : "Speichern"}
        </Knopf>
        <Knopf stil="linie" groesse="klein" onClick={onAbbrechen}>Abbrechen</Knopf>
      </div>
    </div>
  );
}
