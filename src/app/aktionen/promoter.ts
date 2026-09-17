"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { KUERZEL_MUSTER } from "@/lib/promoter";

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
