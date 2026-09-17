import { dienstClient, datenbankVerbunden, serverClient } from "./supabase/server";
import { sitzungStunden, type Rolle } from "./rollen";

/**
 * Wie lange eine Anmeldung fürs Personal gilt und wie stark sie ist.
 *
 * Die eigentliche Grenze zieht die Datenbank (`ist_mitarbeiter`, zuletzt
 * Migration 0022): Danach sieht eine alte Sitzung keine Personal-Daten mehr.
 * Diese Datei sorgt nur dafür, dass die Oberfläche das merkt und zur
 * Anmeldung schickt, statt leere Seiten zu zeigen. Die Dauer je Rolle steht
 * in `rollen.ts` und muss mit der Migration übereinstimmen.
 */

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
export async function sitzungAbgelaufen(rolle: Rolle): Promise<boolean> {
  const seit = await angemeldetSeit();
  if (seit === null) return true;
  return Date.now() / 1000 - seit > sitzungStunden(rolle) * 3600;
}

/**
 * Wurde diese Sitzung mit zweitem Faktor bestätigt?
 *
 * Steht als `aal` im Token ("aal1" = nur Passwort oder Link, "aal2" = dazu
 * ein Einmalcode). Dieselbe Angabe prüft die Datenbank in
 * `ist_mitarbeiter()`; hier wird sie nur gelesen, um die Oberfläche zur
 * Einrichtung zu schicken statt zu leeren Seiten.
 */
export async function mitZweitemFaktor(): Promise<boolean> {
  const db = await serverClient();
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;
  try {
    const nutzlast = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    ) as { aal?: string };
    return nutzlast.aal === "aal2";
  } catch {
    return false;
  }
}

/** Steht die Pflicht zum zweiten Faktor schon scharf? (betrieb.zwei_faktor) */
export async function zweiFaktorPflicht(): Promise<boolean> {
  if (!datenbankVerbunden()) return false;
  try {
    const { data } = await dienstClient()
      .from("betrieb")
      .select("wert")
      .eq("schluessel", "zwei_faktor")
      .maybeSingle();
    return data?.wert === "an";
  } catch {
    // Ohne Dienstschlüssel lässt sich der Schalter nicht lesen. Dann gilt
    // die Pflicht als nicht scharf — die Datenbank entscheidet ohnehin selbst.
    return false;
  }
}
