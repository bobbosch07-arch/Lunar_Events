"use server";

import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";

export type AnmeldeErgebnis =
  | { ok: true }
  | { ok: false; fehler: "email" | "zu_oft" | "unbekannt" };

/**
 * Anmeldung per Link statt Passwort.
 *
 * Für ein Ticketkonto ist das die passende Form: Es gibt nichts zu
 * verwalten außer den eigenen Tickets, und ein vergessenes Passwort wäre
 * genau die Hürde, an der jemand vor dem Einlass scheitert.
 */
export async function sendeAnmeldelink(
  email: string,
  weiter?: string,
): Promise<AnmeldeErgebnis> {
  const adresse = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(adresse)) {
    return { ok: false, fehler: "email" };
  }

  const db = await serverClient();
  const ziel = new URL("/auth/bestaetigen", eigeneAdresse());
  if (weiter) ziel.searchParams.set("weiter", weiter);

  const { error } = await db.auth.signInWithOtp({
    email: adresse,
    options: {
      emailRedirectTo: ziel.toString(),
      // Niemand soll über diesen Weg neue Konten anlegen können, die es
      // nicht gibt? Doch — wer als Gast gekauft hat, hat noch kein Konto.
      // Der Trigger in 0004 verknüpft ihn beim ersten Anmelden.
      shouldCreateUser: true,
    },
  });

  if (error) {
    if (error.status === 429) return { ok: false, fehler: "zu_oft" };
    console.error("[konto] Anmeldelink fehlgeschlagen:", error.message);
    return { ok: false, fehler: "unbekannt" };
  }

  return { ok: true };
}

export async function meldeAb() {
  const db = await serverClient();
  await db.auth.signOut();
  redirect("/");
}

export type PasswortErgebnis =
  | { ok: true }
  | { ok: false; fehler: "falsch" | "zu_oft" | "kein_team" | "zu_kurz" | "unbekannt" };

/** Ist die angemeldete Person aktives Personal mit Backoffice-Zugang? */
async function istTeam(db: Awaited<ReturnType<typeof serverClient>>): Promise<boolean> {
  const { data: nutzer } = await db.auth.getUser();
  if (!nutzer.user) return false;
  const { data } = await db
    .from("mitarbeiter")
    .select("rolle, aktiv")
    .eq("user_id", nutzer.user.id)
    .maybeSingle();
  return Boolean(data?.aktiv && (data.rolle === "admin" || data.rolle === "team"));
}

/**
 * Anmeldung mit Passwort — nur fürs Backoffice-Personal.
 *
 * Gäste bleiben beim Link (siehe oben). Fürs Team ist ein Passwort
 * dagegen der bessere Weg: Wer mehrmals am Tag ins Backoffice schaut,
 * soll nicht jedes Mal auf eine Mail warten, und der Link lässt sich
 * von Messenger-Vorschauen verbrauchen.
 *
 * Meldet sich ein Konto mit Passwort an, das (nicht mehr) zum Team
 * gehört, wird die Sitzung sofort wieder beendet. Sonst wäre das
 * Passwort ein Weg ins Konto, der am Rollenentzug vorbeigeht.
 */
export async function meldeMitPasswortAn(
  email: string,
  passwort: string,
): Promise<PasswortErgebnis> {
  const db = await serverClient();
  const { error } = await db.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: passwort,
  });

  if (error) {
    if (error.status === 429) return { ok: false, fehler: "zu_oft" };
    // Bewusst keine Unterscheidung zwischen "Adresse unbekannt" und
    // "Passwort falsch" — sonst verrät die Seite, wer im Team ist.
    return { ok: false, fehler: "falsch" };
  }

  if (!(await istTeam(db))) {
    await db.auth.signOut();
    return { ok: false, fehler: "kein_team" };
  }
  return { ok: true };
}

/** Passwort setzen oder ändern. Nur für angemeldetes Team-Personal. */
export async function setzePasswort(passwort: string): Promise<PasswortErgebnis> {
  if (passwort.length < 10) return { ok: false, fehler: "zu_kurz" };

  const db = await serverClient();
  if (!(await istTeam(db))) return { ok: false, fehler: "kein_team" };

  // Supabase verrät nirgends, ob ein Konto ein Passwort hat. Deshalb
  // merken wir es uns selbst — nur für die Beschriftung "festlegen" oder
  // "ändern", an der Sicherheit hängt nichts.
  const { error } = await db.auth.updateUser({
    password: passwort,
    data: { passwort_gesetzt: true },
  });
  if (error) {
    console.error("[konto] Passwort setzen fehlgeschlagen:", error.message);
    if (error.status === 429) return { ok: false, fehler: "zu_oft" };
    return { ok: false, fehler: "unbekannt" };
  }
  return { ok: true };
}
