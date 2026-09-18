"use client";

import css from "./Mengenwahl.module.css";

/**
 * Minus, Zahl, Plus — für Zusätze wie die Garderobe (0027). Sieht aus wie
 * der Mengenwähler der Ticketauswahl, damit dieselbe Geste gleich aussieht.
 */
export function Mengenwahl({
  wert,
  max,
  aendern,
  name,
}: {
  wert: number;
  max: number;
  aendern: (neu: number) => void;
  /** Für Screenreader: wovon eines mehr oder weniger. */
  name: string;
}) {
  return (
    <div className={css.menge}>
      <button
        type="button"
        className={css.knopf}
        onClick={() => aendern(Math.max(0, wert - 1))}
        disabled={wert <= 0}
        aria-label={`${name}: eines weniger`}
      >
        −
      </button>
      <span className={css.wert} aria-live="polite" aria-label={`${name}: ${wert}`}>
        {wert}
      </span>
      <button
        type="button"
        className={css.knopf}
        onClick={() => aendern(Math.min(max, wert + 1))}
        disabled={wert >= max}
        aria-label={`${name}: eines mehr`}
      >
        +
      </button>
    </div>
  );
}
