"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import {
  VORKASSE_FRIST_TAGE,
  VORKASSE_MINDEST_TAGE,
  vorkasseEingerichtet,
} from "@/lib/vorkasse";
import { verschickeTickets } from "./ticketmail";

const COOKIE = "lunar_bestellung";

export type VorkasseErgebnis =
  | { ok: true; bis: string }
  | {
      ok: false;
      fehler:
        | "nicht_eingerichtet"
        | "nicht_deine_bestellung"
        | "zu_kurzfristig"
        | "abgelaufen"
        | "nicht_offen"
        | "unbekannt";
    };

/**
 * Der Gast wählt Vorkasse für seine reservierte Bestellung.
 *
 * Wie bei den anderen Zahlungswegen entscheidet das Cookie, ob die
 * Bestellung dieser Person gehört — die ID allein reicht nicht, sie steht
 * in der Adresse.
 */
export async function waehleVorkasse(bestellungId: string): Promise<VorkasseErgebnis> {
  if (!vorkasseEingerichtet()) return { ok: false, fehler: "nicht_eingerichtet" };

  const store = await cookies();
  if (store.get(COOKIE)?.value !== bestellungId) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { data, error } = await db.rpc("waehle_vorkasse", {
    p_bestellung_id: bestellungId,
    p_frist_tage: VORKASSE_FRIST_TAGE,
    p_mindest_tage: VORKASSE_MINDEST_TAGE,
  });

  if (error) {
    const m = error.message;
    if (m.includes("VORKASSE_ZU_KURZFRISTIG")) return { ok: false, fehler: "zu_kurzfristig" };
    if (m.includes("RESERVIERUNG_ABGELAUFEN")) return { ok: false, fehler: "abgelaufen" };
    if (m.includes("BESTELLUNG_NICHT_OFFEN")) return { ok: false, fehler: "nicht_offen" };
    console.error("[vorkasse] Wählen fehlgeschlagen:", m);
    return { ok: false, fehler: "unbekannt" };
  }

  return { ok: true, bis: data as string };
}

export type EingangErgebnis =
  | { ok: true }
  | { ok: false; fehler: "kein_team" | "keine_vorkasse" | "abgelaufen" | "schon_bezahlt" | "unbekannt" };

/**
 * Das Team bestätigt, dass die Überweisung angekommen ist. Erst dann
 * entstehen die Tickets — über dasselbe bestaetige_zahlung() wie bei
 * Stripe und PayPal.
 *
 * Die Rolle wird hier geprüft, weil die eigentliche Arbeit mit dem
 * Dienstschlüssel läuft: Den darf die Sitzung selbst nicht aufrufen.
 */
export async function bestaetigeVorkasse(bestellungId: string): Promise<EingangErgebnis> {
  const sitzung = await serverClient();
  const { data: nutzer } = await sitzung.auth.getUser();
  if (!nutzer.user) return { ok: false, fehler: "kein_team" };

  const { data: m } = await sitzung
    .from("mitarbeiter")
    .select("rolle, aktiv")
    .eq("user_id", nutzer.user.id)
    .maybeSingle();
  if (!m?.aktiv || (m.rolle !== "admin" && m.rolle !== "team")) {
    return { ok: false, fehler: "kein_team" };
  }

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select("vorkasse, status")
    .eq("id", bestellungId)
    .maybeSingle();

  if (!bestellung?.vorkasse) return { ok: false, fehler: "keine_vorkasse" };
  if (bestellung.status === "bezahlt") return { ok: false, fehler: "schon_bezahlt" };
  // Abgelaufen heißt: Die Plätze sind schon wieder frei und womöglich
  // verkauft. Tickets darauf auszustellen, könnte überbuchen — das Geld
  // geht in dem Fall zurück.
  if (bestellung.status === "abgelaufen") return { ok: false, fehler: "abgelaufen" };

  const { error } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "vorkasse",
    p_referenz: `ueberweisung:${nutzer.user.email ?? nutzer.user.id}`,
  });

  if (error) {
    if (error.message.includes("BESTELLUNG_NICHT_OFFEN")) return { ok: false, fehler: "abgelaufen" };
    console.error("[vorkasse] Bestätigen fehlgeschlagen:", error.message);
    return { ok: false, fehler: "unbekannt" };
  }

  await verschickeTickets(bestellungId);
  revalidatePath("/backoffice/bestellungen");
  return { ok: true };
}
