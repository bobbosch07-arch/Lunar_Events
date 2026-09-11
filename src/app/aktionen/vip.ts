"use server";

import { dienstClient } from "@/lib/supabase/server";

export type VipEingabe = {
  name: string;
  email: string;
  telefon: string;
  eventId: string | null;
  gaeste: number;
  wunschdatum: string | null;
  paket: string | null;
  nachricht: string;
  /** Unsichtbares Feld. Menschen füllen es nie aus, einfache Bots schon. */
  falle: string;
  /** Wann das Formular aufgebaut wurde — in Millisekunden. */
  aufgebautUm: number;
};

export type VipErgebnis =
  | { ok: true }
  | { ok: false; fehler: "pflichtfeld" | "email" | "gaeste" | "unbekannt" };

/** Unter drei Sekunden füllt kein Mensch ein achtfeldriges Formular aus. */
const MINDESTDAUER_MS = 3000;

export async function sendeVipAnfrage(eingabe: VipEingabe): Promise<VipErgebnis> {
  // Stille Abwehr: Bots bekommen ein "ok" und merken nichts. Wer sie
  // abweist, sagt ihnen nur, woran sie gescheitert sind.
  if (eingabe.falle.trim() !== "") return { ok: true };
  if (Date.now() - eingabe.aufgebautUm < MINDESTDAUER_MS) return { ok: true };

  const name = eingabe.name.trim();
  const email = eingabe.email.trim().toLowerCase();

  if (!name || !email) return { ok: false, fehler: "pflichtfeld" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return { ok: false, fehler: "email" };
  }
  if (!Number.isInteger(eingabe.gaeste) || eingabe.gaeste < 1 || eingabe.gaeste > 100) {
    return { ok: false, fehler: "gaeste" };
  }

  const db = dienstClient();
  const { error } = await db.from("vip_anfragen").insert({
    event_id: eingabe.eventId,
    name,
    email,
    telefon: eingabe.telefon.trim() || null,
    gaeste: eingabe.gaeste,
    wunschdatum: eingabe.wunschdatum || null,
    paket: eingabe.paket || null,
    nachricht: eingabe.nachricht.trim() || null,
    status: "neu",
  });

  if (error) {
    console.error("[vip] Anfrage fehlgeschlagen:", error.message);
    return { ok: false, fehler: "unbekannt" };
  }

  // Ohne Mailversand landet die Anfrage still in der Datenbank. Damit sie
  // nicht übersehen wird, steht sie wenigstens im Protokoll.
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      `[vip] Neue Anfrage von ${name} <${email}> — kein Mailversand eingerichtet, ` +
        `nachsehen in der Tabelle vip_anfragen.`,
    );
  }

  return { ok: true };
}
