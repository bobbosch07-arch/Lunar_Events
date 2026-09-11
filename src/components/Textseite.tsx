import type { ReactNode } from "react";
import { Kopfzeile } from "./Kopfzeile";
import { Fusszeile } from "./Fusszeile";
import css from "./Textseite.module.css";

/**
 * Gemeinsamer Rahmen für Inhaltsseiten: Über uns, Kontakt, FAQ und die
 * Rechtstexte. Eine Vorlage statt sechs Einzellösungen — sonst driften
 * Abstände und Schriftgrade auseinander, sobald jemand eine Seite
 * nachträgt.
 */
export function Textseite({
  titel,
  vorspann,
  warnung,
  stand,
  children,
}: {
  titel: string;
  vorspann?: string;
  /** Sichtbarer Hinweis über dem Text, etwa auf juristische Prüfung. */
  warnung?: { titel: string; text: string };
  stand?: string;
  children: ReactNode;
}) {
  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile />

      <main id="inhalt" className="abschnitt">
        <div className="seitenbreite">
          <header className={css.kopf}>
            <h1 className={css.titel}>{titel}</h1>
            {vorspann ? <p className={css.vorspann}>{vorspann}</p> : null}
          </header>

          {warnung ? (
            <div className={css.warnung} role="note">
              <span className={css.warnungTitel}>{warnung.titel}</span>
              {warnung.text}
            </div>
          ) : null}

          <div className={css.inhalt}>{children}</div>

          {stand ? <p className={css.stand}>{stand}</p> : null}
        </div>
      </main>

      <Fusszeile />
    </>
  );
}

export function Block({
  titel,
  children,
}: {
  titel: string;
  children: ReactNode;
}) {
  return (
    <section className={css.block}>
      <h2 className={css.blockTitel}>{titel}</h2>
      {children}
    </section>
  );
}

export function Absatz({ children }: { children: ReactNode }) {
  return <p className={css.absatz}>{children}</p>;
}

export function Liste({ punkte }: { punkte: ReactNode[] }) {
  return (
    <ul className={css.liste}>
      {punkte.map((punkt, i) => (
        <li key={i} className={css.listenpunkt}>
          <span className={css.punktMarke} aria-hidden="true">
            —
          </span>
          <span>{punkt}</span>
        </li>
      ))}
    </ul>
  );
}

export function Angaben({ zeilen }: { zeilen: Array<[string, ReactNode]> }) {
  return (
    <dl className={css.definitionen}>
      {zeilen.map(([name, wert]) => (
        <div key={name} style={{ display: "contents" }}>
          <dt className={css.defName}>{name}</dt>
          <dd className={css.defWert}>{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Was der Betreiber noch eintragen muss — sichtbar, nicht versteckt. */
export function Luecke({ children }: { children: ReactNode }) {
  return <span className={css.luecke}>{children}</span>;
}
