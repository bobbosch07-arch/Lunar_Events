import { serverClient } from "./supabase/server";

/**
 * Wie lange eine Anmeldung fürs Personal gilt — gemessen ab der echten
 * Anmeldung, nicht ab der letzten Aktivität.
 *
 * Die eigentliche Grenze zieht die Datenbank (`ist_mitarbeiter`, Migration
 * 0014): Danach sieht eine alte Sitzung keine Personal-Daten mehr. Diese
 * Datei sorgt nur dafür, dass die Oberfläche das merkt und zur Anmeldung
 * schickt, statt leere Seiten zu zeigen. Die Zahlen müssen mit der
 * Migration übereinstimmen.
 */
export const SITZUNG_STUNDEN = {
  admin: 8,
  team: 8,
  einlass: 12,
} as const;

export type PersonalRolle = keyof typeof SITZUNG_STUNDEN;

/**
 * Zeitpunkt der echten Anmeldung in Sekunden, aus `amr` im Token.
 *
 * `iat` taugt nicht: Supabase frischt das Token stündlich auf und setzt
 * `iat` dabei neu. `amr` bleibt beim Auffrischen gleich. Der Token wird
 * hier nicht erneut geprüft — die Identität hat `getUser()` vorher schon
 * beim Server bestätigt, und die Datenbank prüft dieselbe Grenze selbst.
 */
export async function angemeldetSeit(): Promise<number | null> {
  const db = await serverClient();
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  try {
    const nutzlast = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { amr?: Array<{ timestamp?: number }> };
    const zeiten = (nutzlast.amr ?? [])
      .map((e) => e.timestamp)
      .filter((t): t is number => typeof t === "number");
    return zeiten.length ? Math.max(...zeiten) : null;
  } catch {
    return null;
  }
}

/** Ist die Anmeldung für diese Rolle zu alt? Ohne Zeitpunkt: ja. */
export async function sitzungAbgelaufen(rolle: PersonalRolle): Promise<boolean> {
  const seit = await angemeldetSeit();
  if (seit === null) return true;
  return Date.now() / 1000 - seit > SITZUNG_STUNDEN[rolle] * 3600;
}
