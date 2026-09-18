"use server";

import { revalidatePath } from "next/cache";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeVipTickets, versandEingerichtet } from "@/lib/mail";
import { berlinerZeit } from "@/lib/warteliste";

/**
 * VIP-Tickets auf Namen (0028). Ausstellen, Ändern und Stornieren laufen
 * über die Sitzung — `speichere_vip()` und `storniere_vip()` prüfen selbst,
 * ob ein Admin fragt. Nur der Mailversand braucht den Dienstschlüssel und
 * prüft deshalb vorher.
 */

export type VipGastEingabe = { id: string | null; name: string };

export type VipEingabe = {
  anfrageId: string;
  eventId: string;
  tisch: string;
  /** Vereinbarter Betrag in Cent, null = nichts vereinbart. */
  betragCent: number | null;
  bezahlt: boolean;
  gaeste: VipGastEingabe[];
};

export type VipErgebnis =
  | { ok: true; token: string; gaeste: Array<{ id: string; name: string; token: string }> }
  | { ok: false; fehler: string };

const FEHLER: Record<string, string> = {
  keine_berechtigung: "VIP-Tickets ausstellen dürfen nur Admins.",
  unbekannt: "Diese Anfrage oder ein Gast darauf gibt es nicht mehr — Seite neu laden.",
  event: "Bitte ein Event wählen.",
  event_fest:
    "Für diese Anfrage sind schon Tickets zu einem anderen Event ausgestellt. Erst alle stornieren, dann neu ausstellen.",
  name: "Jeder Gast braucht einen Namen (höchstens 120 Zeichen).",
  anzahl: "Eine Buchung hat 1 bis 30 Gäste.",
  tisch: "Der Tisch darf höchstens 40 Zeichen haben.",
  betrag: "Der Betrag kann nicht negativ sein.",
};

export async function speichereVip(eingabe: VipEingabe): Promise<VipErgebnis> {
  const db = await serverClient();
  const { data, error } = await db.rpc("speichere_vip", {
    p_anfrage_id: eingabe.anfrageId,
    p_event_id: eingabe.eventId,
    p_tisch: eingabe.tisch,
    p_betrag_cent: eingabe.betragCent,
    p_bezahlt: eingabe.bezahlt,
    p_gaeste: eingabe.gaeste.map((g) => ({ id: g.id, name: g.name.trim() })),
  });
  if (error || !data) {
    console.error("[vip] Speichern fehlgeschlagen:", error?.message);
    return { ok: false, fehler: "Speichern fehlgeschlagen." };
  }

  const antwort = data as {
    ergebnis: string;
    name?: string;
    token?: string;
    gaeste?: Array<{ id: string; name: string; token: string }>;
  };
  if (antwort.ergebnis === "schon_drin") {
    return {
      ok: false,
      fehler: `${antwort.name ?? "Ein Gast"} ist schon drin und kann nicht mehr entfernt werden.`,
    };
  }
  if (antwort.ergebnis !== "ok" || !antwort.token) {
    return { ok: false, fehler: FEHLER[antwort.ergebnis] ?? "Speichern fehlgeschlagen." };
  }

  revalidatePath("/backoffice/vip");
  revalidatePath(`/backoffice/vip/${eingabe.anfrageId}`);
  return { ok: true, token: antwort.token, gaeste: antwort.gaeste ?? [] };
}

/** Alle Tickets der Buchung zurücknehmen — wer schon drin ist, bleibt drin. */
export async function storniereVip(anfrageId: string): Promise<{ ok: boolean; fehler?: string }> {
  const db = await serverClient();
  const { data, error } = await db.rpc("storniere_vip", { p_anfrage_id: anfrageId });
  const ergebnis = (data as { ergebnis?: string } | null)?.ergebnis;
  if (error || ergebnis !== "ok") {
    return { ok: false, fehler: FEHLER[ergebnis ?? ""] ?? "Stornieren fehlgeschlagen." };
  }
  revalidatePath("/backoffice/vip");
  revalidatePath(`/backoffice/vip/${anfrageId}`);
  return { ok: true };
}

/**
 * Schickt der anfragenden Person den Link mit allen Tickets. Mit
 * Dienstschlüssel — also vorher die Rolle prüfen.
 */
export async function verschickeVipTickets(
  anfrageId: string,
): Promise<{ ok: boolean; fehler?: string }> {
  const sitzung = await serverClient();
  const { data: istAdmin } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  if (istAdmin !== true) return { ok: false, fehler: FEHLER.keine_berechtigung };
  if (!versandEingerichtet()) {
    return { ok: false, fehler: "Es ist kein Mailversand eingerichtet (BREVO_API_KEY fehlt)." };
  }

  const db = dienstClient();
  const { data: anfrage } = await db
    .from("vip_anfragen")
    .select("id, name, email, tisch, token, event:events(titel, beginn, ort:orte(name, stadt))")
    .eq("id", anfrageId)
    .maybeSingle();
  if (!anfrage?.token || !anfrage.event) {
    return { ok: false, fehler: "Für diese Anfrage sind noch keine Tickets ausgestellt." };
  }

  const { data: gaeste } = await db
    .from("gaeste")
    .select("name, erstellt_am")
    .eq("vip_anfrage_id", anfrageId)
    .is("entfernt_am", null)
    .order("erstellt_am", { ascending: true });
  if (!gaeste || gaeste.length === 0) {
    return { ok: false, fehler: "Auf dieser Buchung steht niemand mehr." };
  }

  const event = anfrage.event as unknown as {
    titel: string;
    beginn: string;
    ort: { name: string; stadt: string } | null;
  };

  const ok = await sendeVipTickets({
    an: anfrage.email as string,
    name: anfrage.name as string,
    eventTitel: event.titel,
    wann: berlinerZeit(event.beginn),
    ort: event.ort ? `${event.ort.name}, ${event.ort.stadt}` : "",
    tisch: (anfrage.tisch as string | null) ?? null,
    gaeste: gaeste.map((g) => g.name as string),
    ticketLink: `${eigeneAdresse()}/tickets/${anfrage.token}`,
  });
  if (!ok) return { ok: false, fehler: "Der Mailanbieter hat abgelehnt (Tageslimit?)." };

  await db
    .from("vip_anfragen")
    .update({ tickets_gesendet_am: new Date().toISOString() })
    .eq("id", anfrageId);
  revalidatePath(`/backoffice/vip/${anfrageId}`);
  return { ok: true };
}
