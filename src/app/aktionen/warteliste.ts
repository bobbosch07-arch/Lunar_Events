"use server";

import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeWartelisteBestaetigung, versandEingerichtet } from "@/lib/mail";
import { bedieneWarteliste, berlinerZeit, WARTELISTE_TOKEN } from "@/lib/warteliste";
import { WARTELISTE_MAX_TICKETS } from "@/lib/typen";

export type EintragErgebnis =
  | { ok: true; art: "mail" | "schon_drauf" }
  | { ok: false; fehler: "email" | "anzahl" | "nicht_ausverkauft" | "event_zu" | "versand" };

/**
 * Trägt eine Adresse auf die Warteliste eines ausverkauften Events ein und
 * schickt den Bestätigungslink. Auf der Liste steht erst, wer ihn anklickt.
 */
export async function trageAufWarteliste(eingabe: {
  eventId: string;
  email: string;
  vorname: string;
  anzahl: number;
  /** Honigfalle — Menschen sehen das Feld nicht. */
  falle: string;
}): Promise<EintragErgebnis> {
  // Ein Bot bekommt dieselbe Antwort wie ein Mensch, nur ohne Wirkung.
  if (eingabe.falle.trim() !== "") return { ok: true, art: "mail" };

  const email = eingabe.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 200) {
    return { ok: false, fehler: "email" };
  }
  if (
    !Number.isInteger(eingabe.anzahl) ||
    eingabe.anzahl < 1 ||
    eingabe.anzahl > WARTELISTE_MAX_TICKETS
  ) {
    return { ok: false, fehler: "anzahl" };
  }
  // Ohne Mailversand gäbe es weder Bestätigung noch Angebot — dann lieber
  // gleich sagen, dass es nicht geht.
  if (!datenbankVerbunden() || !versandEingerichtet()) return { ok: false, fehler: "versand" };

  const db = dienstClient();
  const { data, error } = await db.rpc("trage_in_warteliste", {
    p_event_id: eingabe.eventId,
    p_email: email,
    p_vorname: eingabe.vorname.trim().slice(0, 80) || null,
    p_anzahl: eingabe.anzahl,
  });
  if (error || !data) {
    console.error("[warteliste] Eintragen fehlgeschlagen:", error?.message);
    return { ok: false, fehler: "event_zu" };
  }

  const antwort = data as { ergebnis: string; id?: string; token?: string };
  switch (antwort.ergebnis) {
    case "schon_drauf":
      return { ok: true, art: "schon_drauf" };
    case "mail_unterwegs":
      return { ok: true, art: "mail" };
    case "nicht_ausverkauft":
      return { ok: false, fehler: "nicht_ausverkauft" };
    case "anzahl":
      return { ok: false, fehler: "anzahl" };
    case "neu":
      break;
    default:
      return { ok: false, fehler: "event_zu" };
  }

  const { data: event } = await db
    .from("events")
    .select("titel, beginn")
    .eq("id", eingabe.eventId)
    .single();
  if (!event) return { ok: false, fehler: "event_zu" };

  const gesendet = await sendeWartelisteBestaetigung({
    an: email,
    vorname: eingabe.vorname.trim() || null,
    eventTitel: event.titel as string,
    wann: berlinerZeit(event.beginn as string),
    anzahl: eingabe.anzahl,
    link: `${eigeneAdresse()}/warteliste/${antwort.token}`,
  });
  if (!gesendet) return { ok: false, fehler: "versand" };

  const { error: vermerk } = await db
    .from("warteliste")
    .update({ bestaetigung_verschickt_am: new Date().toISOString() })
    .eq("id", antwort.id!);
  if (vermerk) console.error("[warteliste] Versand nicht vermerkt:", vermerk.message);

  return { ok: true, art: "mail" };
}

/**
 * Der Klick auf „Eintrag bestätigen". Ist gerade etwas frei, bekommt die
 * Liste es sofort — nicht erst beim nächsten Takt.
 */
export async function bestaetigeWarteliste(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !WARTELISTE_TOKEN.test(token)) return { ok: false };

  const { data, error } = await dienstClient().rpc("bestaetige_warteliste", { p_token: token });
  if (error || !data) {
    if (error) console.error("[warteliste] Bestätigen fehlgeschlagen:", error.message);
    return { ok: false };
  }
  await bedieneWarteliste(data as string);
  return { ok: true };
}

/**
 * Austragen — oder, wenn schon ein Angebot da ist, die Tickets freigeben.
 * Der Nächste auf der Liste ist dann gleich dran.
 */
export async function verlasseWarteliste(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !WARTELISTE_TOKEN.test(token)) return { ok: false };

  const { data, error } = await dienstClient().rpc("trage_aus_warteliste", { p_token: token });
  if (error || !data) {
    if (error) console.error("[warteliste] Austragen fehlgeschlagen:", error.message);
    return { ok: false };
  }
  await bedieneWarteliste(data as string);
  return { ok: true };
}
