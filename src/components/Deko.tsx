import type { ReactNode } from "react";

/**
 * Kleine Bausteine aus dem Logo, die Violett-Nacht überall wiederholt:
 * der vierzackige Stern und das eine kursive Akzentwort im rosa Balken.
 * Die Sichel selbst ist reines CSS (.sichel in globals.css), weil sie
 * nur eine Form mit Maske ist und je Fläche die Farbe wechselt.
 */

export function Stern({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C12.9 7.6 16.4 11.1 24 12 16.4 12.9 12.9 16.4 12 24 11.1 16.4 7.6 12.9 0 12 7.6 11.1 11.1 7.6 12 0Z" />
    </svg>
  );
}

/**
 * Für t.rich(): `{ akzent }` macht aus `<akzent>dark.</akzent>` im
 * Übersetzungstext das Akzentwort. So bleibt die Markierung im Text, wo
 * sie hingehört, und Englisch darf ein anderes Wort betonen als Deutsch.
 */
export const akzent = (teil: ReactNode) => <em className="akzentwort">{teil}</em>;

const SYMBOLE = {
  kalender: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  uhr: "M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM12 7v5l3 2",
  ort: "M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 7.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z",
} as const;

/** Kleine Linien-Symbole für Eckdaten (Datum, Uhrzeit, Ort). */
export function Eckzeichen({ name, className }: { name: keyof typeof SYMBOLE; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d={SYMBOLE[name]} />
    </svg>
  );
}
