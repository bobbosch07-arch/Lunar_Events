"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { berlinNachUtc } from "@/lib/zeit";

export type PhasenEingabe = {
  id?: string;
  name: string;
  art: "standard" | "vip";
  preis_cent: number;
  gebuehr_cent: number;
  kontingent: number | null;
  leistungen: string[];
  beschreibung: string | null;
  position: number;
  aktiv: boolean;
};

export type EventEingabe = {
  id?: string;
  slug: string;
  titel: string;
  untertitel: string | null;
  teaser: string | null;
  beschreibung: string | null;
  kategorie: string;
  status: string;
  /** Ortszeit aus dem Formular, z. B. "2026-10-24T23:00". */
  beginn: string;
  einlass: string | null;
  ende: string | null;
  ort_id: string | null;
  neuer_ort: { name: string; stadt: string; strasse: string; plz: string } | null;
  mindestalter: number | null;
  dresscode: string | null;
  abendkasse: boolean;
  abendkasse_hinweis: string | null;
  featured: boolean;
  phasen: PhasenEingabe[];
};

export type SpeicherErgebnis =
  | { ok: true; slug: string }
  | { ok: false; fehler: string };

export async function speichereEvent(
  eingabe: EventEingabe,
): Promise<SpeicherErgebnis> {
  const db = await serverClient();

  const slug = eingabe.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) return { ok: false, fehler: "Die Adresse (Slug) fehlt." };
  if (!eingabe.titel.trim()) return { ok: false, fehler: "Der Titel fehlt." };
  if (!eingabe.beginn) return { ok: false, fehler: "Der Beginn fehlt." };

  // --- Ort ---
  let ortId = eingabe.ort_id;
  if (!ortId && eingabe.neuer_ort) {
    const { name, stadt, strasse, plz } = eingabe.neuer_ort;
    if (!name.trim() || !stadt.trim()) {
      return { ok: false, fehler: "Für einen neuen Ort brauchen wir Name und Stadt." };
    }
    const { data, error } = await db
      .from("orte")
      .insert({
        name: name.trim(),
        stadt: stadt.trim(),
        strasse: strasse.trim() || null,
        plz: plz.trim() || null,
        land: "DE",
      })
      .select("id")
      .single();
    if (error) return { ok: false, fehler: `Ort anlegen: ${error.message}` };
    ortId = data.id;
  }
  if (!ortId) return { ok: false, fehler: "Es fehlt der Ort." };

  const zeile = {
    slug,
    titel: eingabe.titel.trim(),
    untertitel: eingabe.untertitel?.trim() || null,
    teaser: eingabe.teaser?.trim() || null,
    beschreibung: eingabe.beschreibung?.trim() || null,
    kategorie: eingabe.kategorie,
    status: eingabe.status,
    beginn: berlinNachUtc(eingabe.beginn),
    einlass: eingabe.einlass ? berlinNachUtc(eingabe.einlass) : null,
    ende: eingabe.ende ? berlinNachUtc(eingabe.ende) : null,
    ort_id: ortId,
    mindestalter: eingabe.mindestalter,
    dresscode: eingabe.dresscode?.trim() || null,
    abendkasse: eingabe.abendkasse,
    abendkasse_hinweis: eingabe.abendkasse_hinweis?.trim() || null,
    featured: eingabe.featured,
    veranstalter: "Lunar Events",
    geaendert_am: new Date().toISOString(),
  };

  const { data: event, error } = eingabe.id
    ? await db.from("events").update(zeile).eq("id", eingabe.id).select("id, slug").single()
    : await db.from("events").insert(zeile).select("id, slug").single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, fehler: `Die Adresse „${slug}" ist schon vergeben.` };
    }
    return { ok: false, fehler: error.message };
  }

  // --- Phasen ---
  const { data: vorhandene } = await db
    .from("phasen")
    .select("id, verkauft")
    .eq("event_id", event.id);

  const behalten = new Set(eingabe.phasen.map((p) => p.id).filter(Boolean));

  // Phasen mit Verkäufen werden nie gelöscht, nur stillgelegt — sonst
  // verlören bezahlte Tickets ihren Bezug.
  for (const alt of vorhandene ?? []) {
    if (behalten.has(alt.id as string)) continue;
    if ((alt.verkauft as number) > 0) {
      await db.from("phasen").update({ aktiv: false }).eq("id", alt.id);
    } else {
      await db.from("phasen").delete().eq("id", alt.id);
    }
  }

  for (const phase of eingabe.phasen) {
    const daten = {
      event_id: event.id,
      name: phase.name.trim(),
      art: phase.art,
      preis_cent: phase.art === "vip" ? 0 : Math.max(0, phase.preis_cent),
      gebuehr_cent: phase.art === "vip" ? 0 : Math.max(0, phase.gebuehr_cent),
      kontingent: phase.kontingent,
      leistungen: phase.leistungen.filter((l) => l.trim()),
      beschreibung: phase.beschreibung?.trim() || null,
      position: phase.position,
      aktiv: phase.aktiv,
    };

    const { error: pf } = phase.id
      ? await db.from("phasen").update(daten).eq("id", phase.id)
      : await db.from("phasen").insert({ ...daten, verkauft: 0 });

    if (pf) return { ok: false, fehler: `Phase „${phase.name}": ${pf.message}` };
  }

  revalidatePath("/backoffice/events");
  revalidatePath("/events");
  revalidatePath(`/events/${event.slug}`);
  revalidatePath("/");

  return { ok: true, slug: event.slug as string };
}

export async function holeOrte() {
  const db = await serverClient();
  const { data } = await db
    .from("orte")
    .select("id, name, stadt")
    .order("stadt");
  return (data ?? []) as Array<{ id: string; name: string; stadt: string }>;
}
