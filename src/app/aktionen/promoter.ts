"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { KUERZEL_MUSTER } from "@/lib/promoter";
import { berlinNachUtc } from "@/lib/zeit";

/**
 * Promoter pflegen. Wie bei den Rabattcodes entscheidet die Zugriffsregel
 * (nur Admins), die Prüfungen hier liefern nur verständliche Sätze.
 */

export type PromoterEingabe = {
  id?: string;
  name: string;
  kuerzel: string;
  aktiv: boolean;
  notiz: string | null;
};

type Ergebnis<T = object> = ({ ok: true } & T) | { ok: false; fehler: string };

const NUR_ADMINS = "Promoter dürfen nur Admins anlegen, ändern oder löschen.";

export async function speicherePromoter(
  eingabe: PromoterEingabe,
): Promise<Ergebnis<{ id: string }>> {
  const name = eingabe.name.trim();
  const kuerzel = eingabe.kuerzel.trim().toLowerCase();

  if (!name) return { ok: false, fehler: "Der Name fehlt." };
  if (!KUERZEL_MUSTER.test(kuerzel)) {
    return {
      ok: false,
      fehler:
        "Das Kürzel braucht 2 bis 32 Zeichen: Kleinbuchstaben ohne Umlaute, Ziffern oder Bindestrich.",
    };
  }

  const zeile = { name, kuerzel, aktiv: eingabe.aktiv, notiz: eingabe.notiz?.trim() || null };
  const db = await serverClient();
  const { data, error } = eingabe.id
    ? await db.from("promoter").update(zeile).eq("id", eingabe.id).select("id").maybeSingle()
    : await db.from("promoter").insert(zeile).select("id").maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, fehler: `Das Kürzel „${kuerzel}“ ist schon vergeben.` };
    }
    if (error.code === "42501" || error.message.includes("row-level security")) {
      return { ok: false, fehler: NUR_ADMINS };
    }
    console.error("[promoter] Speichern fehlgeschlagen:", error.message);
    return { ok: false, fehler: error.message };
  }
  if (!data) return { ok: false, fehler: NUR_ADMINS };

  revalidatePath("/backoffice/promoter");
  return { ok: true, id: data.id as string };
}

/**
 * Ein neuer geheimer Link. Der alte funktioniert ab sofort nicht mehr —
 * gedacht für den Fall, dass er in falsche Hände geraten ist oder jemand
 * nicht mehr dabei ist.
 */
export async function erneuerePromoterLink(id: string): Promise<Ergebnis> {
  const db = await serverClient();
  const { data, error } = await db
    .from("promoter")
    .update({ token: randomBytes(32).toString("hex") })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, fehler: error.message };
  if (!data) return { ok: false, fehler: NUR_ADMINS };

  revalidatePath(`/backoffice/promoter/${id}`);
  return { ok: true };
}

/**
 * Löscht einen Promoter. Seine Codes bleiben bestehen und gehören danach
 * niemandem; Bestellungen verlieren nur die Zuordnung, nicht ihren Rabatt.
 */
export async function loeschePromoter(id: string): Promise<Ergebnis> {
  const db = await serverClient();
  const { data, error } = await db.from("promoter").delete().eq("id", id).select("id");

  if (error) return { ok: false, fehler: error.message };
  if (!data || data.length === 0) return { ok: false, fehler: NUR_ADMINS };

  revalidatePath("/backoffice/promoter");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Staffel je Event (0040)                                             */
/* ------------------------------------------------------------------ */

export type StaffelEingabe = {
  eventId: string;
  /** Ortszeit Berlin aus dem Formular ("2026-11-11T23:59") oder leer. */
  stichtag: string;
  stufen: Array<{ ab: number; belohnung: string }>;
};

/**
 * Speichert Stichtag und Stufen eines Events. Die Stufen werden als Ganzes
 * ersetzt: Ein Formular mit vier Zeilen ist einfacher richtig zu halten als
 * Einzeländerungen. Bestellungen hängen nicht an den Stufen, es geht also
 * nichts verloren.
 */
export async function speichereStaffel(eingabe: StaffelEingabe): Promise<Ergebnis> {
  const db = await serverClient();
  const { data: istAdmin } = await db.rpc("ist_mitarbeiter", { mindestens: "admin" });
  if (istAdmin !== true) return { ok: false, fehler: "Die Staffel dürfen nur Admins ändern." };

  const stufen = eingabe.stufen
    .map((s) => ({ ab: Math.round(s.ab), belohnung: s.belohnung.trim() }))
    .filter((s) => s.belohnung !== "" || Number.isFinite(s.ab));
  if (stufen.length > 12) return { ok: false, fehler: "Höchstens 12 Stufen." };
  for (const s of stufen) {
    if (!Number.isInteger(s.ab) || s.ab < 1 || s.ab > 1000) {
      return { ok: false, fehler: "Jede Stufe braucht eine Ticketzahl zwischen 1 und 1000." };
    }
    if (s.belohnung.length < 1 || s.belohnung.length > 200) {
      return { ok: false, fehler: `Stufe ${s.ab}: Die Belohnung fehlt oder ist länger als 200 Zeichen.` };
    }
  }
  if (new Set(stufen.map((s) => s.ab)).size !== stufen.length) {
    return { ok: false, fehler: "Zwei Stufen haben dieselbe Ticketzahl." };
  }

  let stichtag: string | null = null;
  if (eingabe.stichtag.trim()) {
    try {
      // "23:59" heißt: bis zum Ende dieser Minute. Das Formular kennt keine
      // Sekunden, ein Kauf um 23:59:30 soll trotzdem noch zählen.
      stichtag = new Date(new Date(berlinNachUtc(eingabe.stichtag.trim())).getTime() + 59_999).toISOString();
    } catch {
      return { ok: false, fehler: "Der Stichtag ist kein gültiges Datum." };
    }
  }

  const { data: event, error: eventFehler } = await db
    .from("events")
    .update({ promo_stichtag: stichtag })
    .eq("id", eingabe.eventId)
    .select("slug")
    .maybeSingle();
  if (eventFehler) return { ok: false, fehler: eventFehler.message };
  if (!event) return { ok: false, fehler: "Event nicht gefunden." };

  const { error: weg } = await db.from("promoter_stufen").delete().eq("event_id", eingabe.eventId);
  if (weg) return { ok: false, fehler: weg.message };
  if (stufen.length > 0) {
    const { error: neu } = await db.from("promoter_stufen").insert(
      stufen.map((s) => ({ event_id: eingabe.eventId, ab_tickets: s.ab, belohnung: s.belohnung })),
    );
    if (neu) return { ok: false, fehler: neu.message };
  }

  revalidatePath(`/backoffice/events/${event.slug}`);
  return { ok: true };
}
