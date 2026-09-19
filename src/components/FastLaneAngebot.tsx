"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Knopf } from "./Knopf";
import { preisText } from "@/lib/format";
import { KNAPP_AB, type FastLane } from "@/lib/typen";
import css from "./FastLane.module.css";

/**
 * Das Fast-Lane-Angebot als Fenster in der Mitte.
 *
 * Ein natives `<dialog>` mit `showModal()`: Es hält den Fokus von selbst
 * im Fenster, Escape schließt, und der Rest der Seite ist für
 * Vorleseprogramme stumm — alles, was man bei einem nachgebauten Fenster
 * vergisst.
 *
 * Das Briefing will eigentlich keine Pop-ups; gewünscht ist es trotzdem.
 * Deshalb erscheint es genau einmal je Kasse, lässt sich überall
 * schließen, und die Wahl bleibt danach in der Kasse änderbar — niemand
 * muss sich in diesem Fenster entscheiden.
 */
export function FastLaneAngebot({
  offen,
  angebot,
  anzahl,
  gewaehlt,
  uebernehmen,
  schliessen,
}: {
  offen: boolean;
  angebot: FastLane;
  anzahl: number;
  gewaehlt: boolean;
  uebernehmen: (wahl: boolean) => void;
  schliessen: () => void;
}) {
  const locale = useLocale();
  const fenster = useRef<HTMLDialogElement>(null);
  const [haken, setHaken] = useState(gewaehlt);

  useEffect(() => {
    const d = fenster.current;
    if (!d) return;
    if (offen && !d.open) {
      // Nie vorangekreuzt: Ein kostenpflichtiges Extra muss der Gast selbst
      // anhaken (§ 312a Abs. 3 BGB) — und ein untergeschobenes Upgrade
      // wäre genau der Druck, den das Briefing nicht will.
      setHaken(gewaehlt);
      // Ältere Safari-Versionen kennen showModal nicht oder scheitern daran.
      // Dann lieber kein Angebot als eine Kasse, die nicht mehr reagiert
      // (Rückmeldung iPhone, 19.09.2026).
      try {
        if (typeof d.showModal !== "function") throw new Error("kein dialog");
        d.showModal();
      } catch {
        schliessen();
      }
    }
    if (!offen && d.open) d.close();
    // gewaehlt bewusst nicht als Abhängigkeit: der Haken soll sich beim
    // Öffnen setzen, nicht bei jeder Änderung von außen springen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  const gesamt = angebot.preis_cent * anzahl;
  const knapp = angebot.rest !== null && angebot.rest <= KNAPP_AB;

  return (
    <dialog
      ref={fenster}
      className={css.fenster}
      aria-labelledby="fastlane-titel"
      // Escape und Klick auf den Hintergrund schließen — ohne die Wahl zu
      // ändern.
      onClose={schliessen}
      // Escape selbst abfangen: Chrome lässt ein <dialog>, das ohne
      // vorherigen Klick geöffnet wurde, beim ersten Escape offen
      // (Schutz gegen aufdringliche Pop-ups). Genau so öffnet sich dieses
      // hier — beim Betreten der Kasse.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          schliessen();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        schliessen();
      }}
      onClick={(e) => {
        if (e.target === fenster.current) schliessen();
      }}
    >
      <div className={css.inhalt}>
        <button
          type="button"
          className={css.zu}
          onClick={schliessen}
          aria-label="Schließen"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <span className={css.marke} aria-hidden="true">!</span>

        <span className="eyebrow">Upgrade</span>
        <h2 id="fastlane-titel" className={css.titel}>
          Fast Lane
        </h2>
        <p className={css.text}>
          {angebot.beschreibung ||
            "Eigene Spur am Einlass: Du gehst an der Schlange vorbei und bist direkt drin."}
        </p>

        <p className={css.preis}>
          + {preisText(angebot.preis_cent, locale)}{" "}
          <span className={css.preisZusatz}>pro Ticket</span>
        </p>

        <label className={`${css.wahl} ${haken ? css.wahlAn : ""}`}>
          <input
            type="checkbox"
            checked={haken}
            onChange={(e) => setHaken(e.target.checked)}
          />
          <span>
            Fast Lane für {anzahl === 1 ? "mein Ticket" : `alle ${anzahl} Tickets`}
            <span className={css.wahlPreis}> · + {preisText(gesamt, locale)}</span>
          </span>
        </label>

        {knapp ? (
          <p className={css.knapp}>
            Noch {angebot.rest} {angebot.rest === 1 ? "Fast-Lane-Platz" : "Fast-Lane-Plätze"}.
          </p>
        ) : null}

        <div className={css.knoepfe}>
          <Knopf onClick={() => uebernehmen(haken)} voll>
            {haken ? "Mit Fast Lane weiter" : "Ohne Fast Lane weiter"}
          </Knopf>
        </div>
      </div>
    </dialog>
  );
}
