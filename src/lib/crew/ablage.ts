/**
 * Die Ablage der Crew-App auf dem Gerät: ein einfacher Schlüssel-Wert-Speicher
 * in IndexedDB. Nicht localStorage wie beim alten Scanner: Die Prüfsummen-
 * Liste eines großen Events sprengt dort leicht die fünf Megabyte, und
 * Safari räumt localStorage einer Home-Bildschirm-App eher weg.
 *
 * Wirft nie. Ohne IndexedDB (privates Fenster) liefert `lies` den Standard,
 * und `schreib` tut nichts — dann arbeitet der Scanner eben ohne Ablage.
 */

const NAME = "lunar-crew";
const FACH = "ablage";

let offen: Promise<IDBDatabase | null> | null = null;

function oeffne(): Promise<IDBDatabase | null> {
  offen ??= new Promise((fertig) => {
    try {
      const anfrage = indexedDB.open(NAME, 1);
      anfrage.onupgradeneeded = () => anfrage.result.createObjectStore(FACH);
      anfrage.onsuccess = () => fertig(anfrage.result);
      anfrage.onerror = () => fertig(null);
      anfrage.onblocked = () => fertig(null);
    } catch {
      fertig(null);
    }
  });
  return offen;
}

export async function lies<T>(schluessel: string, standard: T): Promise<T> {
  const db = await oeffne();
  if (!db) return standard;
  return new Promise((fertig) => {
    try {
      const anfrage = db.transaction(FACH, "readonly").objectStore(FACH).get(schluessel);
      anfrage.onsuccess = () => fertig(anfrage.result === undefined ? standard : (anfrage.result as T));
      anfrage.onerror = () => fertig(standard);
    } catch {
      fertig(standard);
    }
  });
}

export async function schreib(schluessel: string, wert: unknown): Promise<void> {
  const db = await oeffne();
  if (!db) return;
  return new Promise((fertig) => {
    try {
      const tx = db.transaction(FACH, "readwrite");
      tx.objectStore(FACH).put(wert, schluessel);
      tx.oncomplete = () => fertig();
      tx.onerror = () => fertig();
      tx.onabort = () => fertig();
    } catch {
      fertig();
    }
  });
}

export const ABLAGE = {
  /** Offene Entscheidungen aller Events, in Reihenfolge. */
  aktionen: "aktionen",
  /** Wer angemeldet ist und welche Rolle: für den Start ohne Netz. */
  person: "person",
  events: "events",
  eventWahl: "event-wahl",
  liste: (eventId: string) => `liste.${eventId}`,
  /** Was dieses Gerät eingelassen hat (Prüfsummen), auch schon nachgetragenes. */
  drin: (eventId: string) => `drin.${eventId}`,
  stand: (eventId: string) => `stand.${eventId}`,
} as const;
