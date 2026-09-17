"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import {
  entferneSchicht,
  setzeAnwesenheit,
  speichereSchicht,
  verschickeSchichtplaene,
} from "@/app/aktionen/schichtplan";
import { ROLLEN, ROLLEN_NAMEN, type Rolle } from "@/lib/rollen";
import { schichtStand, schichtStunden, type Schicht } from "@/lib/typen";
import formular from "./EventFormular.module.css";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

export type SchichtZeile = Schicht & { name: string };
export type PersonZeile = { user_id: string; name: string; rolle: Rolle };

type Stand = {
  id: string | null;
  userId: string;
  rolle: Rolle;
  station: string;
  beginn: string;
  ende: string;
  pauseMin: number;
  notiz: string;
};

/**
 * Der Schichtplan eines Events: oben einteilen, darunter der Plan mit
 * Ein- und Auschecken. Beides nur für Admins — die Zugriffsregeln lassen
 * niemanden sonst schreiben, diese Oberfläche zeigt es nur gar nicht erst.
 */
export function SchichtplanVerwaltung({
  eventId,
  eventSlug,
  eventBeginn,
  eventEnde,
  schichten,
  personal,
  versand,
}: {
  eventId: string;
  eventSlug: string;
  /** Ortszeit für die Voreinstellung im Formular, "2026-11-14T23:00" */
  eventBeginn: string;
  eventEnde: string;
  schichten: SchichtZeile[];
  personal: PersonZeile[];
  versand: boolean;
}) {
  const router = useRouter();
  const leer = useMemo<Stand>(
    () => ({
      id: null,
      userId: personal[0]?.user_id ?? "",
      rolle: personal[0]?.rolle ?? "einlass",
      station: "",
      beginn: eventBeginn,
      ende: eventEnde,
      pauseMin: 30,
      notiz: "",
    }),
    [personal, eventBeginn, eventEnde],
  );
  const [stand, setStand] = useState<Stand>(leer);
  const [meldung, setMeldung] = useState<{ art: "gut" | "schlecht"; text: string } | null>(null);
  const [laeuft, starte] = useTransition();

  const stunden = useMemo(
    () => ({
      gesamt: schichten.reduce((s, x) => s + schichtStunden(x), 0),
      jePerson: schichten.reduce<Record<string, number>>((karte, x) => {
        karte[x.name] = (karte[x.name] ?? 0) + schichtStunden(x);
        return karte;
      }, {}),
    }),
    [schichten],
  );

  function setze<K extends keyof Stand>(schluessel: K, wert: Stand[K]) {
    setStand((alt) => ({ ...alt, [schluessel]: wert }));
    setMeldung(null);
  }

  function speichern() {
    setMeldung(null);
    starte(async () => {
      const antwort = await speichereSchicht({ ...stand, eventId, eventSlug });
      if (!antwort.ok) {
        setMeldung({ art: "schlecht", text: antwort.fehler });
        return;
      }
      setMeldung({ art: "gut", text: stand.id ? "Schicht geändert." : "Eingeteilt." });
      setStand(leer);
      router.refresh();
    });
  }

  function bearbeiten(s: SchichtZeile) {
    setStand({
      id: s.id,
      userId: s.user_id,
      rolle: s.rolle,
      station: s.station ?? "",
      beginn: feldZeit(s.beginn),
      ende: feldZeit(s.ende),
      pauseMin: s.pause_min,
      notiz: s.notiz ?? "",
    });
    setMeldung(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function entfernen(s: SchichtZeile) {
    if (!window.confirm(`Schicht von ${s.name} entfernen?`)) return;
    starte(async () => {
      const antwort = await entferneSchicht(s.id, eventSlug);
      setMeldung(
        antwort.ok
          ? { art: "gut", text: "Schicht entfernt." }
          : { art: "schlecht", text: antwort.fehler },
      );
      router.refresh();
    });
  }

  function anwesenheit(s: SchichtZeile, was: "ein" | "aus" | "zurueck") {
    starte(async () => {
      const antwort = await setzeAnwesenheit(s.id, was, eventSlug);
      if (!antwort.ok) setMeldung({ art: "schlecht", text: antwort.fehler });
      router.refresh();
    });
  }

  function planVerschicken() {
    const sicher = window.confirm(
      "Plan an alle Eingeteilten schicken? Jede Person bekommt ihre eigenen Schichten.",
    );
    if (!sicher) return;
    starte(async () => {
      const antwort = await verschickeSchichtplaene(eventId, eventSlug);
      if (!antwort.ok) {
        setMeldung({ art: "schlecht", text: antwort.fehler });
        return;
      }
      const teile = [`${antwort.verschickt} verschickt`];
      if (antwort.ohneAdresse > 0) teile.push(`${antwort.ohneAdresse} ohne Mailadresse`);
      if (antwort.fehlgeschlagen > 0) teile.push(`${antwort.fehlgeschlagen} nicht angekommen`);
      setMeldung({
        art: antwort.verschickt === 0 ? "schlecht" : "gut",
        text: teile.join(" · ") + ".",
      });
      router.refresh();
    });
  }

  const uhr = (iso: string) =>
    new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

  return (
    <div className={formular.form}>
      <section className={formular.gruppe}>
        <h2 className={formular.gruppenTitel}>
          {stand.id ? "Schicht ändern" : "Einteilen"}
        </h2>
        {personal.length === 0 ? (
          <p className={formular.hinweis}>
            Es ist noch kein Personal angelegt: <code>node scripts/mitarbeiter.mjs</code>
          </p>
        ) : (
          <fieldset className={formular.sperre} disabled={laeuft}>
            <div className={formular.raster}>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="schicht-person">
                  Person
                </label>
                <select
                  id="schicht-person"
                  className={formular.auswahl}
                  value={stand.userId}
                  onChange={(e) => {
                    const person = personal.find((p) => p.user_id === e.target.value);
                    setStand((alt) => ({
                      ...alt,
                      userId: e.target.value,
                      // Vorschlag: die Rolle, die diese Person sonst hat.
                      rolle: person?.rolle ?? alt.rolle,
                    }));
                    setMeldung(null);
                  }}
                >
                  {personal.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name} ({ROLLEN_NAMEN[p.rolle]})
                    </option>
                  ))}
                </select>
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="schicht-rolle">
                  Rolle an diesem Abend
                </label>
                <select
                  id="schicht-rolle"
                  className={formular.auswahl}
                  value={stand.rolle}
                  onChange={(e) => setze("rolle", e.target.value as Rolle)}
                >
                  {ROLLEN.map((r) => (
                    <option key={r} value={r}>
                      {ROLLEN_NAMEN[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="schicht-station">
                  Station
                </label>
                <input
                  id="schicht-station"
                  className={formular.eingabe}
                  value={stand.station}
                  placeholder="z. B. Bar 2, Eingang Nord"
                  onChange={(e) => setze("station", e.target.value)}
                />
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="schicht-beginn">
                  Beginn
                </label>
                <input
                  id="schicht-beginn"
                  type="datetime-local"
                  className={formular.eingabe}
                  value={stand.beginn}
                  onChange={(e) => setze("beginn", e.target.value)}
                />
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="schicht-ende">
                  Ende
                </label>
                <input
                  id="schicht-ende"
                  type="datetime-local"
                  className={formular.eingabe}
                  value={stand.ende}
                  onChange={(e) => setze("ende", e.target.value)}
                />
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="schicht-pause">
                  Pause (Minuten)
                </label>
                <input
                  id="schicht-pause"
                  type="number"
                  min={0}
                  max={599}
                  className={formular.eingabe}
                  value={stand.pauseMin}
                  onChange={(e) => setze("pauseMin", Number(e.target.value))}
                />
              </div>
              <div className={`${formular.feld} ${formular.breit}`}>
                <label className={formular.beschriftung} htmlFor="schicht-notiz">
                  Notiz (sieht die Person in ihrem Plan)
                </label>
                <input
                  id="schicht-notiz"
                  className={formular.eingabe}
                  value={stand.notiz}
                  placeholder="z. B. Schlüssel bei Niklas abholen"
                  onChange={(e) => setze("notiz", e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Knopf onClick={speichern} disabled={laeuft || !stand.userId}>
                {laeuft ? "…" : stand.id ? "Änderung speichern" : "Einteilen"}
              </Knopf>
              {stand.id ? (
                <Knopf stil="linie" onClick={() => setStand(leer)}>
                  Abbrechen
                </Knopf>
              ) : null}
            </div>
          </fieldset>
        )}
      </section>

      {meldung ? (
        <p className={meldung.art === "gut" ? formular.erfolg : formular.stoerung} role="status">
          {meldung.text}
        </p>
      ) : null}

      <section className={formular.gruppe}>
        <h2 className={formular.gruppenTitel}>
          {schichten.length} {schichten.length === 1 ? "Schicht" : "Schichten"} ·{" "}
          {stunden.gesamt.toFixed(2).replace(".", ",")} Stunden
        </h2>
        <span className={formular.hinweis}>
          Ein- und auschecken macht ein Admin für alle. Solange niemand eingecheckt ist, zählen
          die geplanten Zeiten; danach die gemessenen — Pause geht immer ab.
        </span>
        <div className={css.tabellenfeld}>
          <table className={css.tabelle}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Rolle · Station</th>
                <th>Zeit</th>
                <th className={css.zahl}>Pause</th>
                <th className={css.zahl}>Stunden</th>
                <th>Abend</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schichten.length === 0 ? (
                <tr>
                  <td colSpan={7} className={css.leer}>
                    Noch niemand eingeteilt.
                  </td>
                </tr>
              ) : (
                schichten.map((s) => {
                  const lage = schichtStand(s);
                  return (
                    <tr key={s.id}>
                      <td>
                        <div className={css.haupt}>{s.name}</div>
                        {s.plan_gesendet_am ? (
                          <div className={css.nebensache}>Plan verschickt</div>
                        ) : null}
                      </td>
                      <td>
                        <div>{ROLLEN_NAMEN[s.rolle]}</div>
                        {s.station ? <div className={css.nebensache}>{s.station}</div> : null}
                      </td>
                      <td>
                        {uhr(s.beginn)} – {uhr(s.ende)}
                        {s.notiz ? <div className={css.nebensache}>{s.notiz}</div> : null}
                      </td>
                      <td className={css.zahl}>{s.pause_min} min</td>
                      <td className={css.zahl}>
                        {schichtStunden(s).toFixed(2).replace(".", ",")}
                      </td>
                      <td>
                        <span
                          className={`${css.marke_} ${
                            lage === "fertig" ? css.gut : lage === "laeuft" ? css.warte : css.neutral
                          }`}
                        >
                          {lage === "fertig" ? "Fertig" : lage === "laeuft" ? "Da" : "Geplant"}
                        </span>
                        {s.eingecheckt_am ? (
                          <div className={css.nebensache}>
                            ab {uhr(s.eingecheckt_am)}
                            {s.ausgecheckt_am ? ` bis ${uhr(s.ausgecheckt_am)}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                          {lage === "geplant" ? (
                            <button
                              type="button"
                              className={css.textknopf}
                              disabled={laeuft}
                              onClick={() => anwesenheit(s, "ein")}
                            >
                              Einchecken
                            </button>
                          ) : null}
                          {lage === "laeuft" ? (
                            <button
                              type="button"
                              className={css.textknopf}
                              disabled={laeuft}
                              onClick={() => anwesenheit(s, "aus")}
                            >
                              Auschecken
                            </button>
                          ) : null}
                          {lage !== "geplant" ? (
                            <button
                              type="button"
                              className={css.textknopf}
                              disabled={laeuft}
                              onClick={() => anwesenheit(s, "zurueck")}
                            >
                              Zurücksetzen
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={css.textknopf}
                            disabled={laeuft}
                            onClick={() => bearbeiten(s)}
                          >
                            Ändern
                          </button>
                          <button
                            type="button"
                            className={formular.entfernen}
                            disabled={laeuft}
                            onClick={() => entfernen(s)}
                          >
                            Entfernen
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {schichten.length > 0 ? (
          <>
            <span className={formular.hinweis}>
              Stunden je Person:{" "}
              {Object.entries(stunden.jePerson)
                .map(([name, h]) => `${name} ${h.toFixed(2).replace(".", ",")}`)
                .join(" · ")}
            </span>
            <div>
              <Knopf onClick={planVerschicken} disabled={laeuft || !versand}>
                {laeuft ? "…" : "Plan verschicken"}
              </Knopf>
              {!versand ? (
                <span className={formular.hinweis}>
                  Kein Mailversand eingerichtet — die Leute sehen ihren Plan trotzdem unter
                  „Mein Plan“, sobald sie sich anmelden.
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

/** ISO → Wert für ein datetime-local-Feld in Berliner Zeit. */
function feldZeit(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(" ", "T");
}
