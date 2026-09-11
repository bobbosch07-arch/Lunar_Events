/**
 * Eventbilder liegen im Supabase-Storage (Bucket "events"). Gespeichert
 * wird nur der Pfad — die vollstaendige Adresse entsteht erst hier, damit
 * ein Umzug des Speichers nicht jede Zeile in der Datenbank anfasst.
 */
import { SUPABASE_URL } from "./supabase/umgebung";

const BASIS = SUPABASE_URL;

export function bildUrl(pfad: string): string {
  // Schon vollstaendig (z. B. ein Platzhalter aus /public)
  if (pfad.startsWith("http") || pfad.startsWith("/")) return pfad;
  if (!BASIS) return `/${pfad}`;
  return `${BASIS}/storage/v1/object/public/events/${pfad}`;
}
