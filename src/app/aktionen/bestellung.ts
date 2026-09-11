"use server";

import { cookies } from "next/headers";
import { dienstClient } from "@/lib/supabase/server";

/**
 * Der Kauf läuft über zwei Schritte, und beide gehören auf den Server:
 * reservieren (hält das Kontingent) und bestätigen (erzeugt die Tickets).
 * Der Browser darf keinen von beiden direkt auslösen — sonst könnte man
 * sich Tickets ohne Zahlung ausstellen.
 */

const COOKIE = "lunar_bestellung";
/** So lange gilt der Nachweis, die eigene Bestellung sehen zu dürfen. */
const COOKIE_DAUER = 60 * 60 * 4;

export type Auswahlposten = { phase_id: string; menge: number };

export type ReservierungErgebnis =
  | { ok: true; bestellung_id: string; nummer: string; reserviert_bis: string }
  | { ok: false; fehler: string; phase?: string; rest?: number };

/**
 * Übersetzt die Meldungen aus der Datenbank in etwas, das man einem
 * Menschen zeigen kann. Die Datenbank spricht in Kennungen, damit sie
 * sprachunabhängig bleibt.
 */
function deuteFehler(meldung: string): ReservierungErgebnis {
  if (meldung.includes("NICHT_GENUG_TICKETS")) {
    // Form: NICHT_GENUG_TICKETS:<Phasenname>:<Restmenge>
    const [phase, rest] =
      meldung.split("NICHT_GENUG_TICKETS:")[1]?.split(":") ?? [];
    return {
      ok: false,
      fehler: "nicht_genug",
      phase: phase?.trim(),
      rest: Number(rest ?? 0),
    };
  }
  if (meldung.includes("EVENT_VORBEI")) return { ok: false, fehler: "vorbei" };
  if (meldung.includes("EVENT_NICHT_VERFUEGBAR"))
    return { ok: false, fehler: "nicht_verfuegbar" };
  if (meldung.includes("PHASE_NICHT_KAUFBAR"))
    return { ok: false, fehler: "phase_zu" };
  if (meldung.includes("VIP_NUR_AUF_ANFRAGE"))
    return { ok: false, fehler: "vip_anfrage" };
  if (meldung.includes("AUSWAHL_LEER")) return { ok: false, fehler: "leer" };
  return { ok: false, fehler: "unbekannt" };
}

export async function reserviereBestellung(eingabe: {
  eventId: string;
  auswahl: Auswahlposten[];
  email: string;
  vorname: string;
  nachname: string;
  telefon?: string;
}): Promise<ReservierungErgebnis> {
  if (eingabe.auswahl.length === 0) return { ok: false, fehler: "leer" };

  const db = dienstClient();

  const { data: bestellungId, error } = await db.rpc("reserviere", {
    p_event_id: eingabe.eventId,
    p_auswahl: eingabe.auswahl,
    p_email: eingabe.email.trim().toLowerCase(),
    p_vorname: eingabe.vorname.trim() || null,
    p_nachname: eingabe.nachname.trim() || null,
    p_telefon: eingabe.telefon?.trim() || null,
  });

  if (error) return deuteFehler(error.message);

  const { data: bestellung } = await db
    .from("bestellungen")
    .select("nummer, reserviert_bis")
    .eq("id", bestellungId)
    .single();

  // Der Nachweis, diese Bestellung ansehen zu dürfen. Gastkäufe haben
  // kein Konto — ohne das Cookie käme niemand an seine eigene
  // Bestätigungsseite.
  const store = await cookies();
  store.set(COOKIE, bestellungId as string, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_DAUER,
    path: "/",
  });

  return {
    ok: true,
    bestellung_id: bestellungId as string,
    nummer: bestellung?.nummer ?? "",
    reserviert_bis: bestellung?.reserviert_bis ?? "",
  };
}

/**
 * Solange keine Zahlungsanbieter eingerichtet sind, lässt sich der Kauf
 * hiermit abschließen — ausdrücklich als Testweg erkennbar (Zahlungsart
 * "frei"). Sobald Stripe oder PayPal Schlüssel haben, verweigert die
 * Funktion den Dienst: ab da muss echtes Geld fließen.
 */
export async function schliesseTestkaufAb(
  bestellungId: string,
): Promise<{ ok: boolean; nummer?: string; fehler?: string }> {
  if (process.env.STRIPE_SECRET_KEY || process.env.PAYPAL_CLIENT_SECRET) {
    return { ok: false, fehler: "zahlung_eingerichtet" };
  }

  const store = await cookies();
  if (store.get(COOKIE)?.value !== bestellungId) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { error } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "frei",
    p_referenz: "testkauf",
  });

  if (error) return { ok: false, fehler: error.message };

  const { data } = await db
    .from("bestellungen")
    .select("nummer")
    .eq("id", bestellungId)
    .single();

  return { ok: true, nummer: data?.nummer };
}

/** Liest die Bestellung, deren Nachweis im Cookie liegt. */
export async function holeEigeneBestellung(bestellungId: string) {
  const store = await cookies();
  if (store.get(COOKIE)?.value !== bestellungId) return null;

  const db = dienstClient();
  const { data } = await db
    .from("bestellungen")
    .select(
      `id, nummer, status, summe_cent, gebuehr_cent, gesamt_cent, bezahlt_am,
       reserviert_bis,
       kunde:kunden(email, vorname, nachname),
       positionen:bestellpositionen(phase_name, menge, einzelpreis_cent, gebuehr_cent),
       event:events(slug, titel, beginn, ort:orte(name, stadt))`,
    )
    .eq("id", bestellungId)
    .single();

  return data;
}
