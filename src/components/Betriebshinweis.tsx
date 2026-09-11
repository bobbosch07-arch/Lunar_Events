import { datenbankVerbunden } from "@/lib/supabase/server";
import css from "./Betriebshinweis.module.css";

/**
 * Ein schmales Band, das nur erscheint, wenn diese Auslieferung keine
 * Datenbank hat.
 *
 * Im Normalbetrieb ist es unsichtbar. Der Anlass: Die Seite lief eine
 * Weile ohne Datenbank und sah dabei völlig normal aus — erst mit
 * Beispieldaten, später mit leeren Listen. Beides erklärt niemandem,
 * was los ist.
 */
export function Betriebshinweis() {
  if (datenbankVerbunden()) return null;

  return (
    <div className={css.band} role="status">
      <strong>Diese Auslieferung hat keine Datenbank.</strong> Es fehlen die
      Supabase-Zugangsdaten in der Hosting-Umgebung — deshalb sind alle
      Listen leer. Was genau fehlt, steht unter{" "}
      <a href="/api/status">/api/status</a>. Nach dem Nachtragen muss neu
      ausgeliefert werden.
    </div>
  );
}
