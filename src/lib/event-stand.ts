/**
 * Die Form eines Events im Backoffice-Formular — und die Vorlage für eine
 * leere Phase.
 *
 * Das stand bis dahin in `EventFormular.tsx`, und genau dort darf es
 * nicht stehen: Die Datei beginnt mit `"use client"`. Importiert eine
 * Server-Komponente einen Wert aus einem Client-Modul, bekommt sie nicht
 * den Wert, sondern einen Platzhalter, über den React später die
 * Komponente findet. `{ ...LEERE_PHASE }` ergab damit ein Objekt ohne
 * `leistungen` — und „Event anlegen" brach beim Zeichnen ab, während
 * „Event bearbeiten" funktionierte, weil dessen Phasen aus der Datenbank
 * kommen.
 *
 * Eine Datei ohne `"use client"` können beide Seiten lesen.
 */

export type OrtWahl = { id: string; name: string; stadt: string };

export type PhasenStand = {
  id?: string;
  name: string;
  art: "standard" | "vip";
  preisEuro: string;
  gebuehrEuro: string;
  kontingent: string;
  leistungen: string[];
  beschreibung: string;
  aktiv: boolean;
  verkauft: number;
};

export type EventStand = {
  id?: string;
  slug: string;
  titel: string;
  untertitel: string;
  teaser: string;
  beschreibung: string;
  kategorie: string;
  status: string;
  beginn: string;
  einlass: string;
  ende: string;
  ortId: string;
  bildPfad: string;
  bildAlt: string;
  bildFokus: string;
  mindestalter: string;
  dresscode: string;
  abendkasse: boolean;
  abendkasseHinweis: string;
  featured: boolean;
  fastlaneAktiv: boolean;
  fastlanePreisEuro: string;
  /** Leer = unbegrenzt. */
  fastlaneKontingent: string;
  fastlaneBeschreibung: string;
  /** Nur zur Anzeige: schon verkaufte Fast-Lane-Plätze. */
  fastlaneVerkauft: number;
  phasen: PhasenStand[];
};

export const LEERE_PHASE: PhasenStand = {
  name: "",
  art: "standard",
  preisEuro: "",
  gebuehrEuro: "2,50",
  kontingent: "",
  leistungen: ["Eintritt"],
  beschreibung: "",
  aktiv: true,
  verkauft: 0,
};
