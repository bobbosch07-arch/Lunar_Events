"use client";

import { useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { Stern } from "./Deko";
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
 *
 * Seit 30.09.2026 ist "Mit Fast Lane weiter" der große Hauptknopf, "Ohne
 * Fast Lane weiter" steht klein darüber (Wunsch Bobbo). Das ist erlaubt,
 * weil der Gast Fast Lane mit einem eigenen Klick wählt. Vorab angehakt
 * wird trotzdem nichts: Ein Aufpreis, der per Voreinstellung zustande
 * kommt, wird nicht Vertragsbestandteil (§ 312a Abs. 3 BGB) — der Gast
 * könnte ihn zurückverlangen. Schließen, Escape und Klick daneben heißen
 * weiterhin "ohne".
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
  const t = useTranslations("fastlane");
  const fenster = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = fenster.current;
    if (!d) return;
    if (offen && !d.open) {
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
    // Nur auf "offen" reagieren; schliessen ändert sich bei jedem Aufbau.
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
          aria-label={t("schliessen")}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <span className={css.marke} aria-hidden="true">!</span>

        <span className="eyebrow">{t("upgrade")}</span>
        <h2 id="fastlane-titel" className={css.titel}>
          {t("titel")}
        </h2>
        <p className={css.text}>
          {angebot.beschreibung || t("standardtext")}
        </p>

        <p className={css.preis}>
          + {preisText(angebot.preis_cent, locale)}{" "}
          <span className={css.preisZusatz}>{t("proTicket")}</span>
        </p>

        <p className={css.fuer}>
          {t("fuerTickets", { anzahl })}
          <span className={css.wahlPreis}> · + {preisText(gesamt, locale)}</span>
        </p>

        {knapp ? (
          <p className={css.knapp}>
            {t("restKnapp", { rest: angebot.rest ?? 0 })}
          </p>
        ) : null}

        <div className={css.knoepfe}>
          <button type="button" className={css.ohne} onClick={() => uebernehmen(false)}>
            {t("weiterOhne")}
          </button>
          <Knopf onClick={() => uebernehmen(true)} groesse="gross" voll>
            <Stern className={css.knopfStern} />
            {gewaehlt ? t("weiterMit") : t("weiterMitPreis", { preis: preisText(gesamt, locale) })}
          </Knopf>
        </div>
      </div>
    </dialog>
  );
}
