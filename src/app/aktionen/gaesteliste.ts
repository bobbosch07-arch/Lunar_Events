"use server";

import { revalidatePath } from "next/cache";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeGaesteliste, versandEingerichtet } from "@/lib/mail";
import { berlinerZeit } from "@/lib/warteliste";
import { GAST_MAX_BEGLEITUNG } from "@/lib/typen";

/**
 * Gästeliste im Backoffice (0021). Anlegen, Ändern und Entfernen laufen über
 * die Sitzung — die Datenbankfunktionen prüfen selbst, ob ein Admin fragt.
 * Nur der Mailversand braucht den Dienstschlüssel und prüft deshalb vorher.
 */

export type GastEingabe = {
  id: string | null;
  eventId: string;
  eventSlug: string;
  name: string;
  email: string;
  begleitung: number;
  notiz: string;
  /** Nach dem Speichern die QR-Codes per Mail schicken */
  mailSenden: boolean;
};

export type GastErgebnis =
  | { ok: true; token: string; mail: "verschickt" | "fehlgeschlagen" | null }
  | { ok: false; fehler: string };

const FEHLER: Record<string, string> = {
  keine_berechtigung: "Die Gästeliste pflegen dürfen nur Admins.",
  name: "Der Name fehlt.",
  begleitung: `Begleitung geht von 0 bis ${GAST_MAX_BEGLEITUNG}.`,
  unbekannt: "Diesen Eintrag gibt es nicht mehr.",
};

export async function speichereGast(eingabe: GastEingabe): Promise<GastErgebnis> {
  const email = eingabe.email.trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return { ok: false, fehler: "Die Mailadresse sieht nicht richtig aus." };
  }

  const db = await serverClient();
  const { data, error } = await db.rpc("speichere_gast", {
    p_id: eingabe.id,
    p_event_id: eingabe.eventId,
    p_name: eingabe.name,
    p_email: email || null,
    p_begleitung: Math.floor(eingabe.begleitung),
    p_notiz: eingabe.notiz,
  });
  if (error || !data) {
    console.error("[gaesteliste] Speichern fehlgeschlagen:", error?.message);
    return { ok: false, fehler: error?.message ?? "Speichern fehlgeschlagen." };
  }

  const antwort = data as { ergebnis: string; id?: string; token?: string; drin?: number };
  if (antwort.ergebnis === "schon_drin") {
    return {
      ok: false,
      fehler: `Schon ${antwort.drin} Personen eingelassen — weniger geht nicht mehr.`,
    };
  }
  if (antwort.ergebnis !== "ok") {
    return { ok: false, fehler: FEHLER[antwort.ergebnis] ?? antwort.ergebnis };
  }

  let mail: "verschickt" | "fehlgeschlagen" | null = null;
  if (eingabe.mailSenden && email) {
    mail = (await verschickeGastTickets(antwort.id!)).ok ? "verschickt" : "fehlgeschlagen";
  }

  revalidatePath(`/backoffice/gaesteliste/${eingabe.eventSlug}`);
  revalidatePath("/backoffice/events");
  return { ok: true, token: antwort.token!, mail };
}

export async function entferneGast(
  id: string,
  eventSlug: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const db = await serverClient();
  const { data, error } = await db.rpc("entferne_gast", { p_id: id });
  const ergebnis = (data as { ergebnis?: string } | null)?.ergebnis;
  if (error || ergebnis !== "ok") {
    return { ok: false, fehler: FEHLER[ergebnis ?? ""] ?? error?.message ?? "Entfernen fehlgeschlagen." };
  }
  revalidatePath(`/backoffice/gaesteliste/${eventSlug}`);
  revalidatePath("/backoffice/events");
  return { ok: true };
}

/**
 * Schickt einem Gast den Link zu seinen QR-Codes. Mit Dienstschlüssel —
 * also vorher die Rolle prüfen (CLAUDE.md, „Personal-Anmeldungen gelten nur
 * begrenzt").
 */
export async function verschickeGastTickets(id: string): Promise<{ ok: boolean; fehler?: string }> {
  const sitzung = await serverClient();
  const { data: istAdmin } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  if (istAdmin !== true) return { ok: false, fehler: FEHLER.keine_berechtigung };
  if (!versandEingerichtet()) {
    return { ok: false, fehler: "Es ist kein Mailversand eingerichtet (BREVO_API_KEY fehlt)." };
  }

  const db = dienstClient();
  const { data: gast } = await db
    .from("gaeste")
    .select("id, name, email, token, entfernt_am, event:events(slug, titel, beginn, ort:orte(name, stadt))")
    .eq("id", id)
    .maybeSingle();
  if (!gast || gast.entfernt_am || !gast.email) {
    return { ok: false, fehler: "Für diesen Eintrag gibt es keine Mailadresse." };
  }

  const { count: personen } = await db
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("gast_id", id)
    .neq("status", "storniert");

  const event = gast.event as unknown as {
    slug: string;
    titel: string;
    beginn: string;
    ort: { name: string; stadt: string } | null;
  };

  const ok = await sendeGaesteliste({
    an: gast.email as string,
    name: gast.name as string,
    eventTitel: event.titel,
    wann: berlinerZeit(event.beginn),
    ort: event.ort ? `${event.ort.name}, ${event.ort.stadt}` : "",
    personen: personen ?? 1,
    ticketLink: `${eigeneAdresse()}/tickets/${gast.token}`,
  });
  if (!ok) return { ok: false, fehler: "Der Mailanbieter hat abgelehnt (Tageslimit?)." };

  await db.from("gaeste").update({ mail_gesendet_am: new Date().toISOString() }).eq("id", id);
  revalidatePath(`/backoffice/gaesteliste/${event.slug}`);
  return { ok: true };
}
