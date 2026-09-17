"use server";

import { revalidatePath } from "next/cache";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeSchichtplan, versandEingerichtet } from "@/lib/mail";
import { berlinNachUtc } from "@/lib/zeit";
import { istRolle, ROLLEN_NAMEN } from "@/lib/rollen";
import { schichtStunden, type Schicht } from "@/lib/typen";

/**
 * Schichtplan im Backoffice (Migration 0023). Planen, ändern, ein- und
 * auschecken dürfen nur Admins — das entscheiden die Zugriffsregeln, nicht
 * diese Datei. Nur der Mailversand braucht den Dienstschlüssel (er liest
 * Adressen aus der Anmeldung) und prüft die Rolle deshalb vorher selbst.
 */

export type SchichtEingabe = {
  id: string | null;
  eventId: string;
  eventSlug: string;
  userId: string;
  rolle: string;
  station: string;
  /** Ortszeit aus dem Formular, z. B. "2026-11-14T22:00" */
  beginn: string;
  ende: string;
  pauseMin: number;
  notiz: string;
};

export type SchichtErgebnis = { ok: true } | { ok: false; fehler: string };

function deute(meldung: string): string {
  if (meldung.includes("schichten_zeitraum")) return "Das Ende liegt vor dem Beginn.";
  if (meldung.includes("schichten_pause_passt")) return "Die Pause ist länger als die Schicht.";
  if (meldung.includes("schichten_je_person_idx")) {
    return "Diese Person ist zu dieser Uhrzeit schon eingeteilt.";
  }
  if (meldung.includes("row-level security")) return "Schichten planen dürfen nur Admins.";
  return meldung;
}

export async function speichereSchicht(eingabe: SchichtEingabe): Promise<SchichtErgebnis> {
  if (!istRolle(eingabe.rolle)) return { ok: false, fehler: "Diese Rolle gibt es nicht." };
  if (!eingabe.userId) return { ok: false, fehler: "Wähle eine Person." };
  if (!eingabe.beginn || !eingabe.ende) return { ok: false, fehler: "Beginn und Ende fehlen." };

  const zeile = {
    event_id: eingabe.eventId,
    user_id: eingabe.userId,
    rolle: eingabe.rolle,
    station: eingabe.station.trim() || null,
    beginn: berlinNachUtc(eingabe.beginn),
    ende: berlinNachUtc(eingabe.ende),
    pause_min: Math.max(0, Math.floor(eingabe.pauseMin || 0)),
    notiz: eingabe.notiz.trim() || null,
    geaendert_am: new Date().toISOString(),
  };

  const db = await serverClient();
  const { error } = eingabe.id
    ? await db.from("schichten").update(zeile).eq("id", eingabe.id)
    : await db.from("schichten").insert(zeile);

  if (error) {
    console.error("[schichtplan] Speichern fehlgeschlagen:", error.message);
    return { ok: false, fehler: deute(error.message) };
  }

  revalidatePath(`/backoffice/schichtplan/${eingabe.eventSlug}`);
  revalidatePath("/plan");
  return { ok: true };
}

export async function entferneSchicht(id: string, eventSlug: string): Promise<SchichtErgebnis> {
  const db = await serverClient();
  const { error } = await db.from("schichten").delete().eq("id", id);
  if (error) return { ok: false, fehler: deute(error.message) };
  revalidatePath(`/backoffice/schichtplan/${eventSlug}`);
  revalidatePath("/plan");
  return { ok: true };
}

/**
 * Ein- und auschecken am Abend — macht ein Admin für alle (Rückfragen
 * 17.09.2026). „zurueck" räumt einen Fehlgriff weg.
 */
export async function setzeAnwesenheit(
  id: string,
  was: "ein" | "aus" | "zurueck",
  eventSlug: string,
): Promise<SchichtErgebnis> {
  const jetzt = new Date().toISOString();
  const werte =
    was === "ein"
      ? { eingecheckt_am: jetzt, ausgecheckt_am: null }
      : was === "aus"
        ? { ausgecheckt_am: jetzt }
        : { eingecheckt_am: null, ausgecheckt_am: null };

  const db = await serverClient();
  const { error } = await db
    .from("schichten")
    .update({ ...werte, geaendert_am: jetzt })
    .eq("id", id);
  if (error) return { ok: false, fehler: deute(error.message) };

  revalidatePath(`/backoffice/schichtplan/${eventSlug}`);
  revalidatePath("/plan");
  return { ok: true };
}

export type VersandErgebnis =
  | { ok: true; verschickt: number; ohneAdresse: number; fehlgeschlagen: number }
  | { ok: false; fehler: string };

/**
 * Schickt jeder eingeteilten Person ihren Plan für dieses Event. Die Schicht
 * steht in der Mail; der Link führt auf „Mein Plan", wo immer der aktuelle
 * Stand steht — eine Mail von gestern soll niemanden in die falsche Schicht
 * schicken.
 */
export async function verschickeSchichtplaene(
  eventId: string,
  eventSlug: string,
): Promise<VersandErgebnis> {
  const sitzung = await serverClient();
  const { data: istAdmin } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  if (istAdmin !== true) return { ok: false, fehler: "Pläne verschicken dürfen nur Admins." };
  if (!versandEingerichtet()) {
    return { ok: false, fehler: "Es ist kein Mailversand eingerichtet (BREVO_API_KEY fehlt)." };
  }

  const db = dienstClient();
  const { data: event } = await db
    .from("events")
    .select("id, titel, beginn, ort:orte(name, stadt)")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, fehler: "Event nicht gefunden." };

  const { data: schichten } = await db
    .from("schichten")
    .select("*")
    .eq("event_id", eventId)
    .order("beginn");
  if (!schichten?.length) return { ok: false, fehler: "Für dieses Event ist niemand eingeteilt." };

  const { data: personal } = await db.from("mitarbeiter").select("user_id, name");
  const { data: konten } = await db.auth.admin.listUsers({ perPage: 1000 });

  const jePerson = new Map<string, Schicht[]>();
  for (const s of schichten as Schicht[]) {
    jePerson.set(s.user_id, [...(jePerson.get(s.user_id) ?? []), s]);
  }

  const ort = event.ort as unknown as { name: string; stadt: string } | null;
  const zeit = (iso: string, mitDatum = true) =>
    new Intl.DateTimeFormat("de-DE", {
      ...(mitDatum ? { weekday: "short" as const, day: "numeric" as const, month: "long" as const } : {}),
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

  let verschickt = 0;
  let ohneAdresse = 0;
  let fehlgeschlagen = 0;
  const erledigt: string[] = [];

  for (const [userId, eigene] of jePerson) {
    const email = konten?.users.find((u) => u.id === userId)?.email;
    if (!email) {
      ohneAdresse += 1;
      continue;
    }
    const ok = await sendeSchichtplan({
      an: email,
      name: (personal ?? []).find((p) => p.user_id === userId)?.name ?? "",
      eventTitel: event.titel as string,
      wann: zeit(event.beginn as string),
      ort: ort ? `${ort.name}, ${ort.stadt}` : "",
      schichten: eigene.map((s) => ({
        rolle: ROLLEN_NAMEN[s.rolle],
        station: s.station,
        von: zeit(s.beginn),
        bis: zeit(s.ende, false),
        pauseMin: s.pause_min,
        stunden: schichtStunden(s),
        notiz: s.notiz,
      })),
      planLink: `${eigeneAdresse()}/plan`,
    });
    if (ok) {
      verschickt += 1;
      erledigt.push(...eigene.map((s) => s.id));
    } else {
      fehlgeschlagen += 1;
    }
  }

  if (erledigt.length > 0) {
    await db
      .from("schichten")
      .update({ plan_gesendet_am: new Date().toISOString() })
      .in("id", erledigt);
  }

  revalidatePath(`/backoffice/schichtplan/${eventSlug}`);
  return { ok: true, verschickt, ohneAdresse, fehlgeschlagen };
}
