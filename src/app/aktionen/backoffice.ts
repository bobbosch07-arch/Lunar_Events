"use server";

import { revalidatePath } from "next/cache";
import { serverClient, dienstClient } from "@/lib/supabase/server";
import { bedieneWarteliste, berlinerZeit } from "@/lib/warteliste";
import { stripe } from "@/lib/stripe";
import { erstatteZahlung } from "@/lib/paypal";
import { sendeAbsage, versandEingerichtet } from "@/lib/mail";

/**
 * Änderungen aus dem Backoffice laufen über die Sitzung des Mitarbeiters.
 * Wer hier nichts darf, kommt auch mit einem manipulierten Aufruf nicht
 * weiter — die Zugriffsregeln entscheiden, nicht diese Datei.
 */

const ANFRAGE_STATUS = [
  "neu",
  "in_bearbeitung",
  "angebot",
  "bestaetigt",
  "abgelehnt",
] as const;

export async function setzeVipStatus(id: string, status: string) {
  if (!ANFRAGE_STATUS.includes(status as (typeof ANFRAGE_STATUS)[number])) {
    return { ok: false as const, fehler: "unbekannter_status" };
  }

  const db = await serverClient();
  const { error } = await db.from("vip_anfragen").update({ status }).eq("id", id);

  if (error) {
    console.error("[backoffice] VIP-Status setzen fehlgeschlagen:", error.message);
    return { ok: false as const, fehler: error.message };
  }

  revalidatePath("/backoffice/vip");
  return { ok: true as const };
}

export async function speichereVipNotiz(id: string, notiz: string) {
  const db = await serverClient();
  const { error } = await db
    .from("vip_anfragen")
    .update({ notiz_intern: notiz.trim() || null })
    .eq("id", id);

  if (error) return { ok: false as const, fehler: error.message };
  revalidatePath("/backoffice/vip");
  return { ok: true as const };
}

/**
 * Gibt Kontingente aus abgelaufenen Reservierungen frei.
 *
 * Solange kein geplanter Auftrag läuft, ist das der Knopf dafür — besser
 * ein Knopf, den jemand drückt, als blockierte Plätze, die niemand sieht.
 */
export async function raeumeReservierungenAuf() {
  const db = await serverClient();
  const { data, error } = await db.rpc("raeume_reservierungen_auf");

  if (error) {
    console.error("[backoffice] Aufräumen fehlgeschlagen:", error.message);
    return { ok: false as const, fehler: error.message };
  }

  // Was frei wurde, gehört zuerst der Warteliste — wie im Takt.
  await bedieneWarteliste();

  revalidatePath("/backoffice");
  revalidatePath("/backoffice/bestellungen");
  return { ok: true as const, anzahl: (data as number) ?? 0 };
}

export async function setzeEventStatus(id: string, status: string) {
  const erlaubt = ["entwurf", "veroeffentlicht", "abgesagt", "archiviert"];
  if (!erlaubt.includes(status)) {
    return { ok: false as const, fehler: "unbekannter_status" };
  }

  const db = await serverClient();
  const { error } = await db
    .from("events")
    .update({ status, geaendert_am: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[backoffice] Eventstatus setzen fehlgeschlagen:", error.message);
    return { ok: false as const, fehler: error.message };
  }

  revalidatePath("/backoffice/events");
  revalidatePath("/events");
  return { ok: true as const };
}

export type ErstattungErgebnis =
  | {
      ok: true;
      erstattet: number;
      manuell: number;
      fehlgeschlagen: number;
      gemailt: number;
    }
  | { ok: false; fehler: string };

/**
 * Erstattet alle bezahlten Bestellungen eines abgesagten Events (B4).
 *
 * Läuft mit dem Dienstschlüssel (Stripe/PayPal-API), deshalb vorher die
 * Rolle prüfen. Zuerst storniert die Datenbank Tickets und Marken und
 * markiert Vorkasse/Bar zum manuellen Erstatten (`storniere_fuer_absage`);
 * hier zurück kommen nur die Karten- und PayPal-Zahlungen, die über die
 * API zurückgehen. Bestätigt werden die Rückzahlungen wie jede Erstattung
 * über die Webhooks (Status auf „erstattet"). `erstattet_am` verhindert,
 * dass ein zweiter Aufruf dieselbe Zahlung noch einmal zurückbucht.
 */
export async function erstatteEvent(eventId: string): Promise<ErstattungErgebnis> {
  const sitzung = await serverClient();
  const { data: istAdmin } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  if (istAdmin !== true) return { ok: false, fehler: "Erstatten dürfen nur Admins." };

  const db = dienstClient();
  const { data: ev } = await db
    .from("events")
    .select("titel, beginn, status")
    .eq("id", eventId)
    .single();
  if (!ev) return { ok: false, fehler: "Event unbekannt." };
  if (ev.status !== "abgesagt") {
    return { ok: false, fehler: "Erst absagen, dann erstatten." };
  }

  const { data: zuErstatten, error } = await db.rpc("storniere_fuer_absage", {
    p_event_id: eventId,
  });
  if (error) {
    console.error("[absage] Stornieren fehlgeschlagen:", error.message);
    return { ok: false, fehler: error.message };
  }

  let erstattet = 0;
  let fehlgeschlagen = 0;
  for (const b of (zuErstatten ?? []) as Array<{
    bestellung_id: string;
    zahlungsart: string;
    zahlung_ref: string | null;
    gesamt_cent: number;
  }>) {
    try {
      if (!b.zahlung_ref) throw new Error("keine Zahlungsreferenz");
      if (b.zahlungsart === "stripe") {
        await stripe().refunds.create(
          { payment_intent: b.zahlung_ref },
          { idempotencyKey: `absage-${b.bestellung_id}` },
        );
      } else {
        await erstatteZahlung(b.zahlung_ref);
      }
      // „Angestoßen" — den endgültigen Status setzt der Webhook. Das Datum
      // hält einen zweiten Aufruf von einer zweiten Rückbuchung ab.
      await db
        .from("bestellungen")
        .update({ erstattet_am: new Date().toISOString() })
        .eq("id", b.bestellung_id);
      erstattet++;
    } catch (f) {
      console.error("[absage] Erstattung fehlgeschlagen:", b.bestellung_id, (f as Error).message);
      // Bleibt liegen und landet in der Liste „von Hand erstatten".
      await db.from("bestellungen").update({ erstattung_faellig: true }).eq("id", b.bestellung_id);
      fehlgeschlagen++;
    }
  }

  const { count: manuell } = await db
    .from("bestellungen")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("erstattung_faellig", true);

  // Absage-Mail an jeden, der bezahlt hat und noch keine bekam.
  let gemailt = 0;
  if (versandEingerichtet()) {
    const { data: empfaenger } = await db
      .from("bestellungen")
      .select("id, zahlungsart, kunde:kunden(email, vorname)")
      .eq("event_id", eventId)
      .not("bezahlt_am", "is", null)
      .is("absage_mail_am", null);

    for (const b of empfaenger ?? []) {
      const kunde = b.kunde as unknown as { email: string | null; vorname: string | null } | null;
      if (!kunde?.email) continue;
      const automatisch = ["stripe", "paypal", "frei"].includes(b.zahlungsart as string);
      const ok = await sendeAbsage({
        an: kunde.email,
        vorname: kunde.vorname,
        eventTitel: ev.titel as string,
        wann: berlinerZeit(ev.beginn as string),
        automatisch,
      });
      if (ok) {
        await db
          .from("bestellungen")
          .update({ absage_mail_am: new Date().toISOString() })
          .eq("id", b.id);
        gemailt++;
      }
    }
  }

  revalidatePath("/backoffice/events");
  revalidatePath("/backoffice/bestellungen");
  return { ok: true, erstattet, manuell: manuell ?? 0, fehlgeschlagen, gemailt };
}
