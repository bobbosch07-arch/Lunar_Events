"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { bedieneWarteliste } from "@/lib/warteliste";

/**
 * Kontingente einzeln verwalten (0044), aus der Event-Übersicht im
 * Backoffice. Gerechnet und gesperrt wird in der Datenbank; hier stehen
 * nur verständliche Sätze statt Datenbankmeldungen. Ob jemand darf, prüfen
 * die Funktionen selbst (nur Admins).
 */

type Ergebnis = { ok: true } | { ok: false; fehler: string };

function deute(meldung: string): string {
  if (meldung.includes("NUR_ADMIN")) return "Das dürfen nur Admins.";
  const unter = meldung.match(/UNTER_VERKAUFT:(\d+)/);
  if (unter) return `Weniger als die ${unter[1]} schon verkauften oder reservierten Tickets geht nicht.`;
  const zuViel = meldung.match(/ZU_VIEL:(-?\d+)/);
  if (zuViel) return `Frei sind nur ${Math.max(0, Number(zuViel[1]))} Tickets.`;
  if (meldung.includes("UNBEGRENZT")) return "Eine Phase ohne Kontingent (unbegrenzt) kann nichts abgeben oder aufnehmen.";
  if (meldung.includes("GLEICHE_PHASE")) return "Quelle und Ziel sind dieselbe Phase.";
  if (meldung.includes("ANDERES_EVENT") || meldung.includes("ZIEL_UNGUELTIG")) return "Das Ziel gehört nicht zu diesem Event.";
  if (meldung.includes("UNGUELTIG")) return "Die Zahl stimmt nicht.";
  if (meldung.includes("UNBEKANNT")) return "Diese Phase gibt es nicht mehr. Seite neu laden.";
  return meldung;
}

/**
 * Danach: Wer auf der Warteliste steht, ist zuerst dran (wie beim
 * Speichern des Events), und alle Seiten zeigen den neuen Stand.
 */
async function danach(eventId: string | null) {
  if (eventId) await bedieneWarteliste(eventId);
  revalidatePath("/backoffice/events/[slug]", "page");
  revalidatePath("/events/[slug]", "page");
  revalidatePath("/events");
  revalidatePath("/");
}

export async function setzeKontingent(phaseId: string, kontingent: number): Promise<Ergebnis> {
  if (!Number.isInteger(kontingent) || kontingent < 0) return { ok: false, fehler: "Bitte eine ganze Zahl ab 0." };
  const db = await serverClient();
  const { data, error } = await db.rpc("phase_kontingent_setzen", { p_phase: phaseId, p_kontingent: kontingent });
  if (error) return { ok: false, fehler: deute(error.message) };
  await danach((data as { event_id?: string } | null)?.event_id ?? null);
  return { ok: true };
}

export async function verschiebeTickets(von: string, nach: string, menge: number): Promise<Ergebnis> {
  if (!Number.isInteger(menge) || menge < 1) return { ok: false, fehler: "Bitte mindestens 1 Ticket." };
  const db = await serverClient();
  const { data, error } = await db.rpc("phase_tickets_verschieben", { p_von: von, p_nach: nach, p_menge: menge });
  if (error) return { ok: false, fehler: deute(error.message) };
  await danach((data as { event_id?: string } | null)?.event_id ?? null);
  return { ok: true };
}

/** Schließt eine Phase; `verteilung` sagt, wohin ihre freien Tickets gehen. */
export async function schliessePhase(
  phaseId: string,
  verteilung: Array<{ phaseId: string; menge: number }>,
): Promise<Ergebnis> {
  if (verteilung.some((v) => !Number.isInteger(v.menge) || v.menge < 0)) {
    return { ok: false, fehler: "Bitte nur ganze Zahlen ab 0." };
  }
  const db = await serverClient();
  const { data, error } = await db.rpc("phase_schliessen", {
    p_phase: phaseId,
    p_verteilung: verteilung.filter((v) => v.menge > 0).map((v) => ({ phase_id: v.phaseId, menge: v.menge })),
  });
  if (error) return { ok: false, fehler: deute(error.message) };
  await danach((data as { event_id?: string } | null)?.event_id ?? null);
  return { ok: true };
}

export async function oeffnePhase(phaseId: string): Promise<Ergebnis> {
  const db = await serverClient();
  const { data, error } = await db.rpc("phase_oeffnen", { p_phase: phaseId });
  if (error) return { ok: false, fehler: deute(error.message) };
  await danach((data as { event_id?: string } | null)?.event_id ?? null);
  return { ok: true };
}

export type PhasenDetails = {
  /** Ohne id: neue Phase, hinten angehängt. */
  id?: string;
  eventId: string;
  name: string;
  art: "standard" | "vip";
  preis_cent: number;
  gebuehr_cent: number;
  /** Nur beim Anlegen; danach über setzeKontingent. null = unbegrenzt. */
  kontingent?: number | null;
  leistungen: string[];
  beschreibung: string | null;
  abendkasse: boolean;
};

/**
 * Name, Preis, Leistungen einer Phase, oder eine neue Phase. Kontingent,
 * Verkauf und offen/zu fasst diese Aktion bei bestehenden Phasen nicht an:
 * Das laufen eigene, gesperrte Schritte.
 */
export async function speicherePhase(d: PhasenDetails): Promise<Ergebnis> {
  const name = d.name.trim();
  if (!name) return { ok: false, fehler: "Die Phase braucht einen Namen." };
  if (name.length > 80) return { ok: false, fehler: "Der Name ist zu lang (80 Zeichen)." };
  if (!Number.isInteger(d.preis_cent) || d.preis_cent < 0 || !Number.isInteger(d.gebuehr_cent) || d.gebuehr_cent < 0) {
    return { ok: false, fehler: "Preis und Gebühr müssen Beträge ab 0 sein." };
  }
  const vip = d.art === "vip";
  const daten = {
    name,
    art: d.art,
    preis_cent: vip ? 0 : d.preis_cent,
    gebuehr_cent: vip ? 0 : d.gebuehr_cent,
    leistungen: d.leistungen.map((l) => l.trim()).filter(Boolean),
    beschreibung: d.beschreibung?.trim() || null,
    abendkasse: d.abendkasse,
  };

  const db = await serverClient();
  if (d.id) {
    const { data, error } = await db.from("phasen").update(daten).eq("id", d.id).select("id").maybeSingle();
    if (error) return { ok: false, fehler: error.message };
    if (!data) return { ok: false, fehler: "Das dürfen nur Admins." };
  } else {
    if (d.kontingent != null && (!Number.isInteger(d.kontingent) || d.kontingent < 0)) {
      return { ok: false, fehler: "Das Kontingent muss eine ganze Zahl ab 0 sein, oder leer für unbegrenzt." };
    }
    // Hinten anhängen: Die Phasen laufen der Reihe nach, eine neue Phase
    // soll keiner laufenden die Kunden wegnehmen.
    const { data: letzte } = await db
      .from("phasen")
      .select("position")
      .eq("event_id", d.eventId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await db.from("phasen").insert({
      ...daten,
      event_id: d.eventId,
      kontingent: d.kontingent ?? null,
      verkauft: 0,
      aktiv: true,
      position: ((letzte?.position as number | undefined) ?? 0) + 1,
    });
    if (error) return { ok: false, fehler: error.message };
  }
  await danach(d.eventId);
  return { ok: true };
}
