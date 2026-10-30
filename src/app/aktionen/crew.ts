"use server";

import { serverClient } from "@/lib/supabase/server";
import { pruefePasswort } from "@/lib/passwort";
import { meldeAnmeldung } from "@/lib/anmeldemeldung";
import { darfAdresse, darfAnschluss, GRENZEN } from "@/lib/drossel";
import type { PasswortErgebnis } from "./konto";

/**
 * Anmeldung der Crew-App (28.10.2026, entschieden: Passwort fürs Personal).
 *
 * Warum nicht der Link wie bei /einlass: Auf dem iPhone öffnet der Link
 * Safari, und eine Home-Bildschirm-App hat einen eigenen Speicher — die
 * Anmeldung käme dort nie an. Deshalb Mail und Passwort direkt in der App.
 * Das Passwort legt man einmal in Safari fest (/crew/passwort, erreicht über
 * den Anmeldelink).
 *
 * Wie `meldeMitPasswortAn`, nur mit der Stufe "personal" statt "team": Jeder
 * aus dem Team, seit „Mein Plan“ in der App steht (30.10.) — was jemand dort
 * sieht, hängt an der Rolle (`tabsFuer` in CrewApp). Wer die Rolle nicht
 * (mehr) hat, wird sofort wieder abgemeldet — sonst ginge das Passwort am
 * Rollenentzug vorbei.
 */

async function istCrew(db: Awaited<ReturnType<typeof serverClient>>): Promise<boolean> {
  const { data: nutzer } = await db.auth.getUser();
  if (!nutzer.user) return false;
  const { data, error } = await db.rpc("ist_mitarbeiter", { mindestens: "personal" });
  return !error && data === true;
}

export async function meldeCrewAn(email: string, passwort: string): Promise<PasswortErgebnis> {
  const adresse = String(email ?? "").trim().toLowerCase();
  if (
    !(await darfAnschluss("passwort", GRENZEN.passwort)) ||
    !(await darfAdresse("passwort", adresse, GRENZEN.passwort))
  ) {
    return { ok: false, fehler: "zu_oft" };
  }

  const db = await serverClient();
  const { error } = await db.auth.signInWithPassword({ email: adresse, password: passwort });
  if (error) {
    if (error.status === 429) return { ok: false, fehler: "zu_oft" };
    return { ok: false, fehler: "falsch" };
  }

  if (!(await istCrew(db))) {
    await db.auth.signOut();
    return { ok: false, fehler: "kein_team" };
  }

  // Meldet nur Admin-Anmeldungen (siehe anmeldemeldung.ts).
  const { data: nutzer } = await db.auth.getUser();
  if (nutzer.user) await meldeAnmeldung(nutzer.user.id, "Passwort");

  return { ok: true };
}

/** Passwort festlegen oder ändern, für angemeldetes Scan-Personal. */
export async function setzeCrewPasswort(passwort: string): Promise<PasswortErgebnis> {
  const db = await serverClient();
  if (!(await istCrew(db))) return { ok: false, fehler: "kein_team" };

  const { data: nutzer } = await db.auth.getUser();
  const grund = pruefePasswort(passwort, nutzer.user?.email);
  if (grund) return { ok: false, fehler: "zu_schwach", grund };

  const { error } = await db.auth.updateUser({ password: passwort, data: { passwort_gesetzt: true } });
  if (error) {
    console.error("[crew] Passwort setzen fehlgeschlagen:", error.message);
    if (error.status === 429) return { ok: false, fehler: "zu_oft" };
    return { ok: false, fehler: "unbekannt" };
  }
  return { ok: true };
}
