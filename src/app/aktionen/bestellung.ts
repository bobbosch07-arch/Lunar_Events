"use server";

import { cookies } from "next/headers";
import { dienstClient } from "@/lib/supabase/server";
import { stripe, stripeEingerichtet } from "@/lib/stripe";
import { verschickeTickets } from "./ticketmail";
import { CODE_MUSTER, normalisiereCode } from "@/lib/rabatt";
import type { CodeAblehnung, CodeVorschau } from "@/lib/typen";

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
  | {
      ok: true;
      bestellung_id: string;
      nummer: string;
      reserviert_bis: string;
      /** Was die Datenbank verbindlich abzieht — kann von der Vorschau abweichen. */
      code_rabatt_cent: number;
      code_tickets: number;
    }
  | {
      ok: false;
      fehler: string;
      phase?: string;
      rest?: number;
      /** Bei fehler === "code": warum der Code nicht mehr gilt. */
      code?: CodeAblehnung["ergebnis"];
    };

/** Die Kennungen aus reserviere() auf die Gründe der Vorschau abgebildet. */
const CODE_GRUENDE: Record<string, CodeAblehnung["ergebnis"]> = {
  CODE_UNBEKANNT: "unbekannt",
  CODE_NOCH_NICHT: "unbekannt",
  CODE_ABGELAUFEN: "abgelaufen",
  CODE_ANDERES_EVENT: "anderes_event",
  CODE_AUFGEBRAUCHT: "aufgebraucht",
  CODE_PASST_NICHT: "passt_nicht",
  CODE_SCHON_GENUTZT: "schon_genutzt",
};

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
  if (meldung.includes("FASTLANE_AUSVERKAUFT") || meldung.includes("FASTLANE_NICHT_VERFUEGBAR"))
    return { ok: false, fehler: "fastlane_aus" };
  const codeKennung = Object.keys(CODE_GRUENDE).find((k) => meldung.includes(k));
  if (codeKennung) return { ok: false, fehler: "code", code: CODE_GRUENDE[codeKennung] };
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
  /** Für wie viele Tickets Fast Lane dazugebucht wird. */
  fastlane?: number;
  /** Rabattcode, so wie der Gast ihn eingegeben hat. */
  code?: string | null;
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
    p_fastlane: Math.max(0, Math.floor(eingabe.fastlane ?? 0)),
    p_code: eingabe.code ? normalisiereCode(eingabe.code) : null,
  });

  if (error) return deuteFehler(error.message);

  const { data: bestellung } = await db
    .from("bestellungen")
    .select("nummer, reserviert_bis, code_rabatt_cent, code_tickets")
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
    code_rabatt_cent: (bestellung?.code_rabatt_cent as number | undefined) ?? 0,
    code_tickets: (bestellung?.code_tickets as number | undefined) ?? 0,
  };
}

/**
 * Sagt der Kasse, ob ein Code gilt und wie viel er für diese Auswahl
 * ausmacht. Läuft auf dem Server, weil die Datenbankfunktion nur dem
 * Dienstschlüssel offensteht — öffentlich ließen sich Codes sonst in Serie
 * durchprobieren.
 */
export async function pruefeRabattcode(eingabe: {
  eventId: string;
  code: string;
  auswahl: Auswahlposten[];
  fastlane?: number;
}): Promise<CodeVorschau> {
  const code = normalisiereCode(eingabe.code);
  if (!CODE_MUSTER.test(code)) return { ergebnis: "unbekannt" };

  const db = dienstClient();
  const { data, error } = await db.rpc("pruefe_rabattcode", {
    p_code: code,
    p_event_id: eingabe.eventId,
    p_auswahl: eingabe.auswahl,
    p_fastlane: Math.max(0, Math.floor(eingabe.fastlane ?? 0)),
  });

  if (error || !data) {
    console.error("[rabattcode] Prüfen fehlgeschlagen:", error?.message);
    return { ergebnis: "unbekannt" };
  }
  return data as CodeVorschau;
}

/**
 * Schließt eine Bestellung ab, die dank Rabattcode nichts kostet. Über 0 €
 * lässt sich bei Stripe nichts abbuchen, also gibt es nichts abzuwarten.
 *
 * Geprüft wird alles, was einen Missbrauch verhindert: Die Bestellung
 * gehört dem Browser (Cookie), kostet laut Datenbank wirklich 0 €, und das
 * liegt an einem Code — nicht an einer Phase ohne Preis.
 */
export async function schliesseKostenlosAb(
  bestellungId: string,
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const store = await cookies();
  if (store.get(COOKIE)?.value !== bestellungId) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select("status, gesamt_cent, code_rabatt_cent, reserviert_bis, vorkasse")
    .eq("id", bestellungId)
    .single();

  if (!bestellung) return { ok: false, fehler: "unbekannt" };
  if (bestellung.status === "bezahlt") return { ok: true };
  if (
    bestellung.status !== "offen" ||
    bestellung.vorkasse ||
    (bestellung.gesamt_cent as number) !== 0 ||
    (bestellung.code_rabatt_cent as number) <= 0
  ) {
    return { ok: false, fehler: "nicht_kostenlos" };
  }
  if (
    bestellung.reserviert_bis &&
    new Date(bestellung.reserviert_bis as string) < new Date()
  ) {
    return { ok: false, fehler: "abgelaufen" };
  }

  const { error } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "frei",
    p_referenz: "rabattcode",
  });
  if (error) return { ok: false, fehler: error.message };

  await verschickeTickets(bestellungId);
  return { ok: true };
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

  await verschickeTickets(bestellungId);

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
       reserviert_bis, zugangstoken, event_id, vorkasse, rabatt_cent, rabattcode, code_rabatt_cent,
       kunde:kunden(email, vorname, nachname),
       positionen:bestellpositionen(phase_name, menge, einzelpreis_cent, gebuehr_cent),
       event:events(slug, titel, beginn, ort:orte(name, stadt))`,
    )
    .eq("id", bestellungId)
    .single();

  return data;
}

/**
 * Fängt das Wettrennen zwischen Rückleitung und Webhook ab.
 *
 * Stripe schickt den Gast sofort zurück, der Webhook braucht manchmal ein
 * paar Sekunden länger. Ohne das hier stünde auf der Bestätigungsseite
 * "keine Tickets", obwohl bezahlt wurde. Also fragen wir im Zweifel selbst
 * bei Stripe nach. `bestaetige_zahlung` ist mehrfach aufrufbar — wenn der
 * Webhook kurz darauf doch noch kommt, entstehen keine zweiten Tickets.
 */
export async function stelleZahlungSicher(bestellungId: string): Promise<void> {
  if (!stripeEingerichtet()) return;

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select("status, zahlung_ref")
    .eq("id", bestellungId)
    .single();

  if (!bestellung || bestellung.status !== "offen") return;

  const referenz = bestellung.zahlung_ref as string | null;
  if (!referenz?.startsWith("pi_")) return;

  try {
    const absicht = await stripe().paymentIntents.retrieve(referenz);
    if (absicht.status !== "succeeded") return;

    const { error } = await db.rpc("bestaetige_zahlung", {
      p_bestellung_id: bestellungId,
      p_zahlungsart: "stripe",
      p_referenz: absicht.id,
    });
    if (error) console.error("[zahlung] Nachtrag fehlgeschlagen:", error.message);
    else await verschickeTickets(bestellungId);
  } catch (fehler) {
    console.error("[zahlung] Stripe nicht erreichbar:", (fehler as Error).message);
  }
}
