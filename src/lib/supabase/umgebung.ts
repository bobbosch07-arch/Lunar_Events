/**
 * Die Supabase-Zugangsdaten aus der Umgebung.
 *
 * Supabase hat die Schlüssel umbenannt: aus dem "anon key" wurde der
 * "publishable key". Beide Namen kommen in freier Wildbahn vor — in
 * Anleitungen, in älteren Vorlagen, in bestehenden Hosting-
 * Einstellungen. Wir nehmen deshalb beide an.
 *
 * Diese Nachsicht hat einen konkreten Anlass: Die öffentliche Seite lief
 * eine Weile ohne Datenbank, weil in der Hosting-Umgebung der alte Name
 * eingetragen war. Von außen sah alles normal aus.
 *
 * Wichtig: NEXT_PUBLIC_-Variablen werden beim Bauen eingesetzt, nicht
 * beim Ausführen. Ein Eintrag, der nach dem letzten Build hinzukam,
 * wirkt erst nach einem neuen Build.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export const SUPABASE_OEFFENTLICH =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const SUPABASE_GEHEIM =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export function zugangVorhanden(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_OEFFENTLICH);
}

/** Welcher Name wurde tatsächlich gefunden? Nur der Name, nie der Wert. */
export function gefundeneNamen() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    oeffentlich: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        : null,
    geheim: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? "SUPABASE_SERVICE_ROLE_KEY"
      : process.env.SUPABASE_SECRET_KEY
        ? "SUPABASE_SECRET_KEY"
        : null,
  };
}
