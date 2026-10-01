"use server";

import { revalidatePath } from "next/cache";
import { darfMailSchicken } from "@/lib/drossel";
import { dienstClient, datenbankVerbunden, serverClient } from "@/lib/supabase/server";
import {
  sendeNewsletter,
  sendeNewsletterBestaetigung,
  versandEingerichtet,
  type NewsletterMail,
} from "@/lib/mail";
import { eigeneAdresse } from "@/lib/stripe";

export type NewsletterErgebnis =
  | { ok: true }
  | { ok: false; fehler: "email" | "kein_versand" | "unbekannt" };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * Trägt eine Adresse in den Verteiler ein und schickt die Bestätigungsmail
 * (Double Opt-in, C7). Auf der Liste steht erst, wer den Link darin anklickt
 * (`bestaetige_newsletter`); vorher ist die Zeile nur ein Vormerker.
 *
 * Antwortet auch mit „ok", wenn die Adresse schon bestätigt drinsteht — wer
 * anders antwortet, verrät, welche Adressen bekannt sind. Dann geht keine
 * zweite Mail raus.
 */
export async function trageInVerteilerEin(
  email: string,
): Promise<NewsletterErgebnis> {
  const adresse = email.trim().toLowerCase();
  if (!EMAIL.test(adresse) || adresse.length > 200) {
    return { ok: false, fehler: "email" };
  }
  if (!datenbankVerbunden()) return { ok: false, fehler: "unbekannt" };
  // Ohne Mailversand gibt es keine Bestätigung — dann lieber gleich sagen,
  // dass es nicht geht, statt still eine unbestätigte Adresse abzulegen.
  if (!versandEingerichtet()) return { ok: false, fehler: "kein_versand" };
  // Gegen Skripte, die den Verteiler mit fremden Adressen fluten (0032).
  if (!(await darfMailSchicken("newsletter", adresse))) return { ok: true };

  const db = dienstClient();
  const { data: vorhanden } = await db
    .from("newsletter")
    .select("token, bestaetigt, abgemeldet_am")
    .eq("email", adresse)
    .maybeSingle();

  // Schon bestätigt und nicht abgemeldet: nichts tun, still „ok".
  if (vorhanden?.bestaetigt && !vorhanden.abgemeldet_am) return { ok: true };

  let token = vorhanden?.token as string | undefined;
  if (!vorhanden) {
    const { data: neu, error } = await db
      .from("newsletter")
      .insert({ email: adresse })
      .select("token")
      .single();
    if (error || !neu) {
      console.error("[newsletter] Eintragen fehlgeschlagen:", error?.message);
      return { ok: false, fehler: "unbekannt" };
    }
    token = neu.token as string;
  } else if (vorhanden.abgemeldet_am) {
    // Wer sich abgemeldet hatte, meldet sich neu an: den Vermerk lösen,
    // aber erst der Klick bestätigt wieder.
    await db.from("newsletter").update({ abgemeldet_am: null }).eq("email", adresse);
  }

  const ok = await sendeNewsletterBestaetigung({
    an: adresse,
    link: `${eigeneAdresse()}/newsletter/bestaetigen/${token}`,
  });
  if (!ok) return { ok: false, fehler: "unbekannt" };

  return { ok: true };
}

/** Der Klick auf den Bestätigungslink aus der Mail. */
export async function bestaetigeNewsletter(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !/^[0-9a-f]{16,128}$/.test(token)) return { ok: false };
  const { data, error } = await dienstClient().rpc("bestaetige_newsletter", { p_token: token });
  if (error) console.error("[newsletter] Bestätigen fehlgeschlagen:", error.message);
  return { ok: data === true };
}

/** Der Klick auf den Abmeldelink. */
export async function meldeNewsletterAb(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !/^[0-9a-f]{16,128}$/.test(token)) return { ok: false };
  const { data, error } = await dienstClient().rpc("melde_newsletter_ab", { p_token: token });
  if (error) console.error("[newsletter] Abmelden fehlgeschlagen:", error.message);
  return { ok: data === true };
}

/* ------------------------------------------------------------------ */
/* Backoffice: schreiben und verschicken (0039)                        */
/* ------------------------------------------------------------------ */

export type Entwurf = { betreff: string; text: string; eventId: string | null };

/**
 * So viele Mails je Aufruf. Die Oberfläche ruft so lange nach, bis nichts
 * mehr offen ist; ein Aufruf bleibt damit weit unter der Zeitgrenze einer
 * Serverfunktion. Brevo verschickt im kostenlosen Tarif 300 Mails am Tag.
 */
const JE_AUFRUF = 50;
const GLEICHZEITIG = 10;

async function istAdmin(): Promise<boolean> {
  // Mit dem Dienstschlüssel geht es weiter — also vorher die Rolle prüfen
  // (CLAUDE.md, "Personal-Anmeldungen gelten nur begrenzt").
  const sitzung = await serverClient();
  const { data } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  return data === true;
}

function pruefeEntwurf(e: Entwurf): string | null {
  if (!e.betreff.trim() || e.betreff.trim().length > 150) return "Betreff fehlt oder ist zu lang (150 Zeichen).";
  if (!e.text.trim() || e.text.length > 10000) return "Text fehlt oder ist zu lang.";
  if (e.eventId && !/^[0-9a-f-]{36}$/.test(e.eventId)) return "Event unbekannt.";
  return null;
}

async function eventFuerMail(eventId: string | null): Promise<NewsletterMail["event"] | null> {
  if (!eventId) return undefined;
  const { data: event } = await dienstClient()
    .from("events")
    .select("titel, slug, beginn, status, ort:orte(name, stadt)")
    .eq("id", eventId)
    .maybeSingle();
  // Ein Entwurf hätte einen Link ins Leere — dann lieber gar nicht senden.
  if (!event || event.status !== "veroeffentlicht") return null;
  const ort = event.ort as unknown as { name: string; stadt: string } | null;
  const wann = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(event.beginn as string));
  const adresse = eigeneAdresse();
  return {
    titel: event.titel as string,
    wann: `${wann} Uhr`,
    ort: ort ? `${ort.name}, ${ort.stadt}` : "",
    link: `${adresse}/events/${event.slug}`,
    bild: `${adresse}/events/${event.slug}/opengraph-image`,
  };
}

/** Schickt den Entwurf an die eigene Adresse, bevor er an alle geht. */
export async function sendeNewsletterTest(
  entwurf: Entwurf,
): Promise<{ ok: true; an: string } | { ok: false; grund: string }> {
  if (!(await istAdmin())) return { ok: false, grund: "Nur für Admins." };
  const fehler = pruefeEntwurf(entwurf);
  if (fehler) return { ok: false, grund: fehler };

  const { data: nutzer } = await (await serverClient()).auth.getUser();
  const an = nutzer.user?.email;
  if (!an) return { ok: false, grund: "Deine Adresse ist unbekannt." };

  const event = await eventFuerMail(entwurf.eventId);
  if (event === null) return { ok: false, grund: "Das Event ist nicht veröffentlicht." };

  const adresse = eigeneAdresse();
  const ergebnis = await sendeNewsletter({
    an,
    betreff: `[Test] ${entwurf.betreff.trim()}`,
    text: entwurf.text,
    event,
    // Kein echter Token: Der Abmeldeknopf in der Testmail tut nichts.
    abmeldeLink: `${adresse}/newsletter/abmelden/test`,
    einKlickLink: `${adresse}/api/newsletter/abmelden?t=test`,
  });
  return ergebnis.ok ? { ok: true, an } : ergebnis;
}

/** Legt eine Ausgabe an; verschickt wird mit `sendeAusgabe`. */
export async function legeAusgabeAn(
  entwurf: Entwurf,
): Promise<{ ok: true; id: string } | { ok: false; grund: string }> {
  if (!(await istAdmin())) return { ok: false, grund: "Nur für Admins." };
  const fehler = pruefeEntwurf(entwurf);
  if (fehler) return { ok: false, grund: fehler };
  if (!versandEingerichtet()) return { ok: false, grund: "Es ist kein Mailversand eingerichtet." };
  if ((await eventFuerMail(entwurf.eventId)) === null) {
    return { ok: false, grund: "Das Event ist nicht veröffentlicht." };
  }

  const { data: nutzer } = await (await serverClient()).auth.getUser();
  const { data, error } = await dienstClient()
    .from("newsletter_ausgaben")
    .insert({
      betreff: entwurf.betreff.trim(),
      text: entwurf.text.trim(),
      event_id: entwurf.eventId,
      erstellt_von: nutzer.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, grund: error?.message ?? "Anlegen fehlgeschlagen." };
  revalidatePath("/backoffice/newsletter");
  return { ok: true, id: data.id as string };
}

export type AusgabeErgebnis =
  | { ok: true; verschickt: number; offen: number }
  | { ok: false; grund: string; verschickt: number; offen: number };

/**
 * Verschickt den nächsten Stapel einer Ausgabe an bestätigte Adressen, die
 * sie noch nicht haben. Scheitert ein ganzer Stapel, ist fast sicher das
 * Tageslimit erreicht: Dann hört der Aufruf auf und sagt den Grund; der
 * Rest geht beim nächsten Mal raus.
 */
export async function sendeAusgabe(ausgabeId: string): Promise<AusgabeErgebnis> {
  if (!(await istAdmin())) return { ok: false, grund: "Nur für Admins.", verschickt: 0, offen: 0 };

  const db = dienstClient();
  const { data: ausgabe } = await db
    .from("newsletter_ausgaben")
    .select("id, betreff, text, event_id")
    .eq("id", ausgabeId)
    .maybeSingle();
  if (!ausgabe) return { ok: false, grund: "Ausgabe nicht gefunden.", verschickt: 0, offen: 0 };

  const event = await eventFuerMail(ausgabe.event_id as string | null);
  if (event === null) {
    return { ok: false, grund: "Das Event ist nicht mehr veröffentlicht.", verschickt: 0, offen: 0 };
  }

  const [{ data: empfaenger }, { data: erledigt }] = await Promise.all([
    db
      .from("newsletter")
      .select("email, token")
      .eq("bestaetigt", true)
      .is("abgemeldet_am", null)
      .order("bestaetigt_am"),
    db.from("newsletter_zustellungen").select("email").eq("ausgabe_id", ausgabeId),
  ]);
  const schon = new Set((erledigt ?? []).map((z) => String(z.email).toLowerCase()));
  const offenAlle = (empfaenger ?? []).filter((e) => !schon.has(String(e.email).toLowerCase()));
  const stapel = offenAlle.slice(0, JE_AUFRUF) as Array<{ email: string; token: string }>;

  const adresse = eigeneAdresse();
  let verschickt = 0;
  let grund: string | null = null;

  for (let i = 0; i < stapel.length; i += GLEICHZEITIG) {
    const teil = stapel.slice(i, i + GLEICHZEITIG);
    const ergebnisse = await Promise.all(
      teil.map((e) =>
        sendeNewsletter({
          an: e.email,
          betreff: ausgabe.betreff as string,
          text: ausgabe.text as string,
          event,
          abmeldeLink: `${adresse}/newsletter/abmelden/${e.token}`,
          einKlickLink: `${adresse}/api/newsletter/abmelden?t=${e.token}`,
        }),
      ),
    );
    const angekommen = teil.filter((_, j) => ergebnisse[j].ok).map((e) => e.email);
    if (angekommen.length > 0) {
      const { error } = await db
        .from("newsletter_zustellungen")
        .insert(angekommen.map((email) => ({ ausgabe_id: ausgabeId, email })));
      if (error) console.error("[newsletter] Zustellung nicht vermerkt:", error.message);
      verschickt += angekommen.length;
    }
    const fehlschlag = ergebnisse.find((r) => !r.ok);
    if (fehlschlag && !fehlschlag.ok) grund = fehlschlag.grund;
    if (angekommen.length === 0) break;
  }

  const offen = offenAlle.length - verschickt;
  if (offen === 0) {
    await db
      .from("newsletter_ausgaben")
      .update({ abgeschlossen_am: new Date().toISOString() })
      .eq("id", ausgabeId);
  }
  revalidatePath("/backoffice/newsletter");
  return grund ? { ok: false, grund, verschickt, offen } : { ok: true, verschickt, offen };
}

/** Nimmt eine Adresse ganz aus dem Verteiler — etwa auf Löschwunsch. */
export async function entferneAbonnent(email: string): Promise<{ ok: boolean }> {
  if (!(await istAdmin())) return { ok: false };
  const { error } = await dienstClient().from("newsletter").delete().eq("email", email);
  if (error) console.error("[newsletter] Entfernen fehlgeschlagen:", error.message);
  revalidatePath("/backoffice/newsletter");
  return { ok: !error };
}
