/**
 * Passwortregeln fürs Personal.
 *
 * Länge schützt mehr als Sonderzeichen-Pflicht: „Sommer2026!" erfüllt jede
 * Zeichenregel und steht trotzdem in jeder Liste. Deshalb mindestens
 * 12 Zeichen, dazu werden die häufigsten Passwörter, einfache Muster und
 * die eigene Mailadresse abgelehnt.
 *
 * Läuft auf dem Server (verbindlich) und im Formular (sofortige Rückmeldung)
 * — deshalb ohne Abhängigkeiten.
 *
 * Wichtig: Diese Prüfung greift nur über unser Formular. Supabase selbst
 * muss im Dashboard dieselbe Mindestlänge verlangen, sonst ließe sich ein
 * kurzes Passwort direkt über die Schnittstelle setzen.
 */

export const PASSWORT_MINDESTLAENGE = 12;

/** Häufige Passwörter und Wortbestandteile — kleingeschrieben verglichen. */
const GESPERRT = [
  "passwort", "password", "qwertz", "qwerty", "asdfgh", "yxcvbn", "iloveyou",
  "letmein", "welcome", "willkommen", "hallo", "admin", "login", "geheim",
  "sommer", "winter", "fruehling", "herbst", "fussball", "schalke", "bayern",
  "dortmund", "eintracht", "darmstadt", "lunar", "lunarevents", "events",
  "ticket", "tickets", "backoffice", "einlass", "niklas", "bobbo",
];

export function pruefePasswort(passwort: string, email?: string | null): string | null {
  const klein = passwort.toLowerCase();

  if (passwort.length < PASSWORT_MINDESTLAENGE) {
    return `Mindestens ${PASSWORT_MINDESTLAENGE} Zeichen.`;
  }

  // Ein Zeichen oder zwei im Wechsel: "aaaaaaaaaaaa", "abababababab"
  if (new Set(klein).size <= 3) {
    return "Zu wenige verschiedene Zeichen.";
  }

  // Durchgehende Folgen wie 123456789012 oder abcdefghijkl
  let folge = 1;
  for (let i = 1; i < klein.length; i++) {
    const schritt = klein.charCodeAt(i) - klein.charCodeAt(i - 1);
    folge = schritt === 1 || schritt === -1 ? folge + 1 : 1;
    if (folge >= 6) return "Keine Zahlen- oder Buchstabenfolgen wie 123456.";
  }

  // Was nach Entfernen von Ziffern und Zeichen übrig bleibt, darf kein
  // gesperrtes Wort sein: "Passwort2026!" → "passwort".
  const kern = klein.replace(/[^a-zäöüß]/g, "");
  if (GESPERRT.some((wort) => kern === wort || kern === wort + wort)) {
    return "Zu leicht zu erraten — nimm lieber einen ganzen Satz.";
  }

  // Nicht nur die ganze Adresse: Schon ein Stück davon ("niklasreyes2026")
  // steht in jedem Wörterbuchangriff, der die Adresse kennt. Geprüft wird
  // jeder Abschnitt aus 6 aufeinanderfolgenden Zeichen.
  const lokalteil = email?.split("@")[0]?.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
  if (lokalteil && lokalteil.length >= 4) {
    const breite = Math.min(6, lokalteil.length);
    for (let i = 0; i + breite <= lokalteil.length; i++) {
      if (klein.includes(lokalteil.slice(i, i + breite))) {
        return "Das Passwort darf keinen Teil der eigenen Mailadresse enthalten.";
      }
    }
  }

  return null;
}
