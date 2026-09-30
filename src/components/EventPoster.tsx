import { Stern } from "./Deko";
import css from "./EventPoster.module.css";

type Props = {
  titel: string;
  /** Kleine Zeile unter dem Titel, z. B. Ort und Stadt. */
  zeile?: string;
};

/**
 * Das Bild für Events ohne Foto: Verlauf, Sichel, Titel. Entschieden am
 * 30.09.2026 — ein hochgeladenes Foto oder ein Flyer geht immer vor, das
 * Poster springt nur ein, wo sonst eine leere Fläche wäre.
 *
 * Füllt das Elternelement (position: relative erwartet) und skaliert mit
 * dessen Breite, deshalb passt es auf Karte, Eventseite und Ticket.
 */
export function EventPoster({ titel, zeile }: Props) {
  return (
    <div className={css.poster} aria-hidden="true">
      <span className={`sichel ${css.sichel}`} />
      <Stern className={css.sternGross} />
      <Stern className={css.sternKlein} />
      <div className={css.unten}>
        <span className={css.titel}>{titel}</span>
        {zeile ? <span className={css.zeile}>{zeile}</span> : null}
      </div>
    </div>
  );
}
