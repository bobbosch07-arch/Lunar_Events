"use server";

import QRCode from "qrcode";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { stelleZahlungSicher } from "./bestellung";

/**
 * Abendkasse (Migration 0025). Verkauft wird über die Sitzung der Person an
 * der Kasse — die Datenbank prüft die Rolle (`ist_mitarbeiter('kasse')`).
 * Wo mit dem Dienstschlüssel weitergelesen wird, steht die Prüfung vorher.
 */

export type TuerVerkauf =
  | {
      ok: true;
      bestellungId: string;
      nummer: string;
      gesamtCent: number;
      bezahlt: boolean;
      eingelassen: boolean;
      anzahl: number;
      /** QR für den Gast: bei "qr" der Zahllink, bei "nur verkaufen" die Tickets. */
      qr: string | null;
    }
  | { ok: false; fehler: string };

const FEHLER: Record<string, string> = {
  keine_berechtigung: "Verkaufen dürfen nur Kasse und Admin.",
  menge: "Zwischen 1 und 20 Tickets.",
  zahlungsart: "Unbekannte Zahlungsart.",
  event_zu: "Für dieses Event wird nicht mehr verkauft.",
  phase_unbekannt: "Diese Phase gibt es an der Abendkasse nicht.",
  phase_zu: "Diese Phase ist nicht aktiv.",
};

async function qrSvg(inhalt: string): Promise<string> {
  return QRCode.toString(inhalt, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

export async function verkaufeAnDerTuer(eingabe: {
  eventId: string;
  phaseId: string;
  menge: number;
  zahlung: "bar" | "qr";
  einlassen: boolean;
}): Promise<TuerVerkauf> {
  const db = await serverClient();
  const { data, error } = await db.rpc("verkaufe_abendkasse", {
    p_event_id: eingabe.eventId,
    p_phase_id: eingabe.phaseId,
    p_menge: Math.floor(eingabe.menge),
    p_zahlung: eingabe.zahlung,
    p_einlassen: eingabe.einlassen,
    p_email: null,
  });
  if (error || !data) {
    console.error("[kasse] Verkauf fehlgeschlagen:", error?.message);
    return { ok: false, fehler: "Das hat nicht geklappt. Nochmal versuchen." };
  }

  const antwort = data as {
    ergebnis: string;
    rest?: number;
    bestellung_id?: string;
    nummer?: string;
    zugangstoken?: string;
    gesamt_cent?: number;
    bezahlt?: boolean;
    eingelassen?: boolean;
    codes?: string[];
  };
  if (antwort.ergebnis === "ausverkauft") {
    return {
      ok: false,
      fehler:
        antwort.rest === 0
          ? "Abendkasse ausverkauft."
          : `Nur noch ${antwort.rest} ${antwort.rest === 1 ? "Ticket" : "Tickets"} übrig.`,
    };
  }
  if (antwort.ergebnis !== "ok") {
    return { ok: false, fehler: FEHLER[antwort.ergebnis] ?? antwort.ergebnis };
  }

  const adresse = eigeneAdresse();
  // Bar und eingelassen: Der Gast braucht nichts mehr in der Hand.
  // Bar, aber nicht eingelassen: Er bekommt seine Tickets als Link.
  // QR: Er zahlt über den Link mit seinem Handy.
  const qr =
    eingabe.zahlung === "qr"
      ? await qrSvg(`${adresse}/kasse/zahlen/${antwort.zugangstoken}`)
      : !eingabe.einlassen
        ? await qrSvg(`${adresse}/tickets/${antwort.zugangstoken}`)
        : null;

  return {
    ok: true,
    bestellungId: antwort.bestellung_id!,
    nummer: antwort.nummer!,
    gesamtCent: antwort.gesamt_cent ?? 0,
    bezahlt: Boolean(antwort.bezahlt),
    eingelassen: Boolean(antwort.eingelassen),
    anzahl: Math.floor(eingabe.menge),
    qr,
  };
}

/** Rolle prüfen, bevor mit dem Dienstschlüssel gelesen wird. */
async function istKasse(): Promise<boolean> {
  const { data } = await (await serverClient()).rpc("ist_mitarbeiter", { mindestens: "kasse" });
  return data === true;
}

export type TuerZahlungStand =
  | { art: "wartet" }
  | { art: "bezahlt"; eingelassen: number }
  | { art: "abgelaufen" }
  | { art: "fehler"; text: string };

/**
 * Hat der Gast mit seinem Handy bezahlt? Die Kasse fragt alle paar
 * Sekunden. Kommt der Webhook zu spät, fragt diese Funktion selbst bei
 * Stripe nach — wie die Bestätigungsseite im Online-Kauf.
 */
export async function pruefeTuerZahlung(
  bestellungId: string,
  einlassen: boolean,
): Promise<TuerZahlungStand> {
  if (!(await istKasse())) return { art: "fehler", text: "Keine Berechtigung." };

  const db = dienstClient();
  const lies = async () =>
    (
      await db
        .from("bestellungen")
        .select("status, reserviert_bis, abendkasse")
        .eq("id", bestellungId)
        .maybeSingle()
    ).data;

  let bestellung = await lies();
  if (!bestellung?.abendkasse) return { art: "fehler", text: "Bestellung unbekannt." };

  if (bestellung.status === "offen") {
    await stelleZahlungSicher(bestellungId);
    bestellung = await lies();
  }

  if (bestellung?.status === "bezahlt") {
    if (!einlassen) return { art: "bezahlt", eingelassen: 0 };
    const { data } = await (await serverClient()).rpc("abendkasse_einlassen", {
      p_bestellung_id: bestellungId,
    });
    const eingelassen = (data as { eingelassen?: number } | null)?.eingelassen ?? 0;
    return { art: "bezahlt", eingelassen };
  }

  if (
    bestellung?.status !== "offen" ||
    (bestellung.reserviert_bis && new Date(bestellung.reserviert_bis as string) < new Date())
  ) {
    return { art: "abgelaufen" };
  }
  return { art: "wartet" };
}

/**
 * Der Gast will doch nicht oder geht weg, bevor er zahlt: Die Tickets
 * sofort wieder freigeben, statt 20 Minuten zu blockieren.
 */
export async function brecheTuerVerkaufAb(bestellungId: string): Promise<{ ok: boolean }> {
  if (!(await istKasse())) return { ok: false };
  const db = dienstClient();
  const { error } = await db
    .from("bestellungen")
    .update({ reserviert_bis: new Date(Date.now() - 1000).toISOString() })
    .eq("id", bestellungId)
    .eq("abendkasse", true)
    .eq("status", "offen");
  if (error) return { ok: false };
  await db.rpc("raeume_reservierungen_auf");
  return { ok: true };
}

export type Kassenstand = {
  tickets: number;
  barCent: number;
  qrCent: number;
  offen: number;
};

/** Was heute an der Tür eingenommen wurde — für die Abrechnung am Ende. */
export async function holeKassenstand(eventId: string): Promise<Kassenstand | null> {
  const { data } = await (await serverClient()).rpc("abendkasse_stand", { p_event_id: eventId });
  const stand = data as {
    ergebnis: string;
    tickets?: number;
    bar_cent?: number;
    qr_cent?: number;
    offen?: number;
  } | null;
  if (stand?.ergebnis !== "ok") return null;
  return {
    tickets: stand.tickets ?? 0,
    barCent: stand.bar_cent ?? 0,
    qrCent: stand.qr_cent ?? 0,
    offen: stand.offen ?? 0,
  };
}
