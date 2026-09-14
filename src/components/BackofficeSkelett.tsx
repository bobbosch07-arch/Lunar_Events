import css from "@/app/[locale]/backoffice/backoffice.module.css";

/**
 * Platzhalter, solange eine Abfrage läuft.
 *
 * Der Zweck ist nicht Schönheit, sondern Antwort: Ohne ihn blieb nach
 * einem Klick auf einen Reiter sekundenlang die *alte* Seite stehen, und
 * nichts deutete darauf hin, dass überhaupt etwas passiert.
 */
export function BackofficeSkelett({
  kacheln = 0,
  zeilen = 6,
}: {
  kacheln?: number;
  zeilen?: number;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className={css.nurVorleser}>Lädt …</span>

      {kacheln > 0 ? (
        <div className={css.kennzahlen}>
          {Array.from({ length: kacheln }, (_, i) => (
            <div key={i} className={css.kachel}>
              <span className={`${css.platzhalter} ${css.platzhalterKlein}`} />
              <span className={`${css.platzhalter} ${css.platzhalterGross}`} />
            </div>
          ))}
        </div>
      ) : null}

      <div className={css.tabellenfeld}>
        {Array.from({ length: zeilen }, (_, i) => (
          <div key={i} className={css.platzhalterZeile}>
            <span className={css.platzhalter} style={{ width: `${70 - (i % 4) * 12}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
