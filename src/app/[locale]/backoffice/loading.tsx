import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import css from "./backoffice.module.css";

/**
 * Gilt für alle Backoffice-Seiten, die keine eigene Fassung mitbringen.
 *
 * Der zweite Zweck ist wichtiger als der sichtbare: Erst durch diese
 * Datei kann Next beim Vorausladen eines Reiters überhaupt etwas
 * ablegen. Eine Seite, die bei jedem Aufruf die Datenbank fragt, lässt
 * sich nicht vorausladen — ihre Ladeansicht schon. Der Klick zeigt
 * deshalb sofort etwas, statt auf die Antwort zu warten.
 */
export default function Laedt() {
  return (
    <>
      <div className={css.zeile}>
        <span
          className={`${css.platzhalter} ${css.platzhalterGross}`}
          style={{ width: 220, height: 34 }}
        />
      </div>
      <BackofficeSkelett kacheln={4} />
    </>
  );
}
