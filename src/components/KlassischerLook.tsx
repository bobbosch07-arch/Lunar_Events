/**
 * Schaltet die ganze Seite auf den klassischen Look (Navy, Ivory, Gold,
 * Syne) — für die Werkzeuge des Personals. Gäste sehen Violett-Nacht.
 *
 * Ein leeres Element genügt: tokens.css hebt es per
 * `:root:has([data-thema="klassisch"])` auf die ganze Seite, also auch
 * auf body, Dialoge und alles, was außerhalb des eigenen Baums landet.
 * Deshalb muss es nichts umschließen und kann in jedem Zweig einer
 * Seite stehen, der früh zurückkehrt.
 */
export function KlassischerLook() {
  return <span data-thema="klassisch" hidden />;
}
