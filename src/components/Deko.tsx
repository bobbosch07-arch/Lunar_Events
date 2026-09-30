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
