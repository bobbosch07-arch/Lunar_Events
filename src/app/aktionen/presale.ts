"use server";

import { revalidatePath } from "next/cache";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { sendePresaleEinladung, versandEingerichtet } from "@/lib/mail";
import { eigeneAdresse } from "@/lib/stripe";

export type EinladungsErgebnis =
  | { ok: true; verschickt: number; fehlgeschlagen: number; offen: number }
  | { ok: false; fehler: string };

/**
 * So viele Mails je Klick. Klein genug, dass die Aktion nicht an die
 * Zeitgrenze einer Serverfunktion stößt; wer mehr Gäste hat, klickt noch
 * einmal. Brevo verschickt im kostenlosen Tarif 300 Mails am Tag.
 */
const JE_KLICK = 60;
const GLEICHZEITIG = 10;

/**
 * Lädt frühere Gäste per Mail in den Presale eines Events ein.
 *
 * Wer schon eine Einladung hat, bekommt keine zweite. Scheitert der Versand
 * mehrfach hintereinander — meist das Tageslimit beim Mailanbieter —, hört
 * die Aktion auf; die übrigen Einladungen bleiben unverschickt stehen und
 * gehen beim nächsten Klick raus.
 */
export async function sendePresaleEinladungen(eventId: string): Promise<EinladungsErgebnis> {
  // Mit dem Dienstschlüssel geht es weiter — also vorher die Rolle prüfen
  // (CLAUDE.md, "Personal-Anmeldungen gelten nur begrenzt").
  const sitzung = await serverClient();
  const { data: istAdmin } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  if (istAdmin !== true) {
    return { ok: false, fehler: "Einladungen verschicken dürfen nur Admins." };
  }
  if (!versandEingerichtet()) {
    return { ok: false, fehler: "Es ist kein Mailversand eingerichtet (BREVO_API_KEY fehlt)." };
  }

  const db = dienstClient();
  const { data: event } = await db
    .from("events")
    .select("id, slug, titel, beginn, status, presale_ab, verkauf_ab")
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return { ok: false, fehler: "Event nicht gefunden." };
  if (event.status !== "veroeffentlicht") {
    return { ok: false, fehler: "Das Event ist noch nicht veröffentlicht — der Link führte ins Leere." };
  }
  if (!event.presale_ab || !event.verkauf_ab) {
    return { ok: false, fehler: "Für dieses Event ist kein Presale eingestellt." };
  }
  if (new Date(event.verkauf_ab as string) <= new Date()) {
    return { ok: false, fehler: "Der öffentliche Verkauf läuft schon — der Vorsprung ist vorbei." };
  }

  const { data: faellige, error } = await db.rpc("bereite_presale_einladungen_vor", {
    p_event_id: eventId,
    p_grenze: JE_KLICK,
  });
  if (error) {
    console.error("[presale] Einladungen vorbereiten fehlgeschlagen:", error.message);
    return { ok: false, fehler: error.message };
  }

  const adresse = eigeneAdresse();
  const zeit = (iso: string, mitWochentag = false) =>
    new Intl.DateTimeFormat("de", {
      ...(mitWochentag ? { weekday: "long" as const } : {}),
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

  const liste = (faellige ?? []) as Array<{
    id: string;
    token: string;
    email: string;
    vorname: string | null;
  }>;
  const erledigt: string[] = [];
  let fehlgeschlagen = 0;

  for (let i = 0; i < liste.length; i += GLEICHZEITIG) {
    const stapel = liste.slice(i, i + GLEICHZEITIG);
    const ergebnisse = await Promise.all(
      stapel.map((e) =>
        sendePresaleEinladung({
          an: e.email,
          vorname: e.vorname,
          eventTitel: event.titel as string,
          wann: zeit(event.beginn as string, true),
          oeffentlichAb: zeit(event.verkauf_ab as string, true),
          link: `${adresse}/events/${event.slug}?einladung=${e.token}`,
          abmeldeLink: `${adresse}/werbung/abmelden/${e.token}`,
        }),
      ),
    );
    ergebnisse.forEach((ok, j) => {
      if (ok) erledigt.push(stapel[j].id);
      else fehlgeschlagen += 1;
    });
    // Scheitert ein ganzer Stapel, ist fast sicher das Tageslimit erreicht.
    if (ergebnisse.every((ok) => !ok)) break;
  }

  if (erledigt.length > 0) {
    const { error: vermerk } = await db
      .from("presale_einladungen")
      .update({ verschickt_am: new Date().toISOString() })
      .in("id", erledigt);
    if (vermerk) console.error("[presale] Versand nicht vermerkt:", vermerk.message);
  }

  const { count: offen } = await db
    .from("presale_einladungen")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("verschickt_am", null);

  revalidatePath(`/backoffice/events/${event.slug}`);
  return { ok: true, verschickt: erledigt.length, fehlgeschlagen, offen: offen ?? 0 };
}
