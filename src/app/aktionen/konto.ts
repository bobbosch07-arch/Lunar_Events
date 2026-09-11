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
