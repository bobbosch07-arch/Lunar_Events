"use server";

import { dienstClient } from "@/lib/supabase/server";
import { stripe, stripeEingerichtet } from "@/lib/stripe";
import { verschickeTickets } from "./ticketmail";
import { CODE_MUSTER, normalisiereCode } from "@/lib/rabatt";
import { holeWartelisteEintrag } from "@/lib/warteliste";
import type { CodeAblehnung, CodeVorschau, VerkaufsStand } from "@/lib/typen";
import {
  darfAnschluss,
  EMAIL_MUSTER,
  GRENZEN,
  MAX_JE_BESTELLUNG,
  MAX_JE_PHASE,
  MAX_POSTEN,
} from "@/lib/drossel";

/**
 * Der Kauf läuft über zwei Schritte, und beide gehören auf den Server:
 * reservieren (hält das Kontingent) und bestätigen (erzeugt die Tickets).
 * Der Browser darf keinen von beiden direkt auslösen — sonst könnte man
 * sich Tickets ohne Zahlung ausstellen.
 */

import { setzeBestellCookie, bestellCookieGilt } from "@/lib/bestellcookie";

export type Auswahlposten = { phase_id: string; menge: number };

export type ReservierungErgebnis =
  | {
      ok: true;
      bestellung_id: string;
      nummer: string;
      reserviert_bis: string;
      /** Was die Datenbank verbindlich abzieht — kann von der Vorschau abweichen. */
      code_rabatt_cent: number;
      code_tickets: number;
    }
  | {
      ok: false;
      fehler: string;
      phase?: string;
      rest?: number;
      /** Bei fehler === "code": warum der Code nicht mehr gilt. */
      code?: CodeAblehnung["ergebnis"];
    };

/** Die Kennungen aus reserviere() auf die Gründe der Vorschau abgebildet. */
const CODE_GRUENDE: Record<string, CodeAblehnung["ergebnis"]> = {
  CODE_UNBEKANNT: "unbekannt",
  CODE_NOCH_NICHT: "unbekannt",
  CODE_ABGELAUFEN: "abgelaufen",
  CODE_ANDERES_EVENT: "anderes_event",
  CODE_AUFGEBRAUCHT: "aufgebraucht",
  CODE_PASST_NICHT: "passt_nicht",
  CODE_SCHON_GENUTZT: "schon_genutzt",
};

/**
 * Übersetzt die Meldungen aus der Datenbank in etwas, das man einem
 * Menschen zeigen kann. Die Datenbank spricht in Kennungen, damit sie
 * sprachunabhängig bleibt.
 */
function deuteFehler(meldung: string): ReservierungErgebnis {
  if (meldung.includes("NICHT_GENUG_TICKETS")) {
    // Form: NICHT_GENUG_TICKETS:<Phasenname>:<Restmenge>
    const [phase, rest] =
      meldung.split("NICHT_GENUG_TICKETS:")[1]?.split(":") ?? [];
    return {
      ok: false,
      fehler: "nicht_genug",
      phase: phase?.trim(),
      rest: Number(rest ?? 0),
    };
  }
  if (meldung.includes("FASTLANE_AUSVERKAUFT") || meldung.includes("FASTLANE_NICHT_VERFUEGBAR"))
    return { ok: false, fehler: "fastlane_aus" };
  if (meldung.includes("GARDEROBE_")) {
    // Form: GARDEROBE_AUSVERKAUFT:<Rest> bzw. GARDEROBE_MENGE:<Höchstmenge>
    const rest = Number(meldung.split(/GARDEROBE_[A-Z_]+:/)[1]?.match(/\d+/)?.[0] ?? 0);
    return { ok: false, fehler: "garderobe_aus", rest };
  }
  const codeKennung = Object.keys(CODE_GRUENDE).find((k) => meldung.includes(k));
  if (codeKennung) return { ok: false, fehler: "code", code: CODE_GRUENDE[codeKennung] };
  if (meldung.includes("PRESALE_ANDERE_ADRESSE")) return { ok: false, fehler: "presale_adresse" };
  if (meldung.includes("PRESALE_ZUGANG_FEHLT")) return { ok: false, fehler: "presale_zugang" };
  if (meldung.includes("VERKAUF_NOCH_NICHT")) return { ok: false, fehler: "verkauf_noch_nicht" };
  if (meldung.includes("EVENT_VORBEI")) return { ok: false, fehler: "vorbei" };
  if (meldung.includes("EVENT_NICHT_VERFUEGBAR"))
    return { ok: false, fehler: "nicht_verfuegbar" };
  if (meldung.includes("PHASE_NICHT_KAUFBAR"))
    return { ok: false, fehler: "phase_zu" };
  if (meldung.includes("VIP_NUR_AUF_ANFRAGE"))
    return { ok: false, fehler: "vip_anfrage" };
  if (meldung.includes("AUSWAHL_LEER")) return { ok: false, fehler: "leer" };
  return { ok: false, fehler: "unbekannt" };
}

export async function reserviereBestellung(eingabe: {
  eventId: string;
  auswahl: Auswahlposten[];
  email: string;
  vorname: string;
  nachname: string;
  telefon?: string;
  /** Für wie viele Tickets Fast Lane dazugebucht wird. */
  fastlane?: number;
  /** Rabattcode, so wie der Gast ihn eingegeben hat. */
  code?: string | null;
  /** Kürzel aus dem Link eines Promoters */
  promo?: string | null;
  /** Token einer persönlichen Presale-Einladung */
  einladung?: string | null;
  /** Wie viele Stück Garderobe (0027). */
  garderobe?: number;
}): Promise<ReservierungErgebnis> {
  if (!Array.isArray(eingabe.auswahl) || eingabe.auswahl.length === 0) {
    return { ok: false, fehler: "leer" };
  }

  // Die Grenzen der Oberfläche gelten hier noch einmal: Diese Aktion lässt
  // sich aus der Konsole mit beliebigen Werten aufrufen (0032).
  const mengen = eingabe.auswahl.map((p) => p?.menge);
  if (
    eingabe.auswahl.length > MAX_POSTEN ||
    !mengen.every((m) => Number.isInteger(m) && m >= 1 && m <= MAX_JE_PHASE) ||
    mengen.reduce((a, b) => a + b, 0) > MAX_JE_BESTELLUNG
  ) {
    return { ok: false, fehler: "menge" };
  }
  const email = String(eingabe.email ?? "").trim().toLowerCase();
  if (!EMAIL_MUSTER.test(email) || email.length > 200) return { ok: false, fehler: "email" };

  const db = dienstClient();

  // Höchstens drei unbezahlte Reservierungen je Adresse gleichzeitig …
  const { count: offene } = await db
    .from("bestellungen")
    .select("id, kunde:kunden!inner(email)", { count: "exact", head: true })
    .eq("status", "offen")
    .eq("vorkasse", false)
    .gt("reserviert_bis", new Date().toISOString())
    .eq("kunde.email", email);
  if ((offene ?? 0) >= GRENZEN.offeneJeAdresse) return { ok: false, fehler: "zu_viele" };

  // … und höchstens 40 reservierte Tickets je Anschluss in 15 Minuten.
  const anzahl = mengen.reduce((a, b) => a + b, 0);
  if (!(await darfAnschluss("reservieren", GRENZEN.reservierenTickets, anzahl))) {
    return { ok: false, fehler: "zu_viele" };
  }

  const { data: bestellungId, error } = await db.rpc("reserviere", {
    p_event_id: eingabe.eventId,
    p_auswahl: eingabe.auswahl,
    p_email: email,
    p_vorname: String(eingabe.vorname ?? "").trim().slice(0, 100) || null,
    p_nachname: String(eingabe.nachname ?? "").trim().slice(0, 100) || null,
    p_telefon: String(eingabe.telefon ?? "").trim().slice(0, 40) || null,
    p_fastlane: Math.max(0, Math.floor(eingabe.fastlane ?? 0)),
    p_code: eingabe.code ? normalisiereCode(eingabe.code) : null,
    p_einladung: eingabe.einladung ?? null,
    p_garderobe: Math.max(0, Math.floor(eingabe.garderobe ?? 0)),
  });

  if (error) return deuteFehler(error.message);

  // Diese Kasse zeigt den Hinweis auf Einladungen zu künftigen Events
  // (§ 7 Abs. 3 UWG). Nur Bestellungen mit diesem Vermerk dürfen später eine
  // Presale-Einladung bekommen. Wer die Kasse ändert und den Hinweis
  // entfernt, muss auch diese Zeile entfernen.
  const { error: hinweis } = await db
    .from("bestellungen")
    .update({ werbehinweis: true })
    .eq("id", bestellungId);
  if (hinweis) console.error("[bestellung] Werbehinweis nicht vermerkt:", hinweis.message);

  // Promoter zuordnen — über seinen Code oder sein Kürzel. Scheitert das,
  // geht der Kauf trotzdem weiter: Die Zählung ist Beiwerk.
  const { error: zuordnung } = await db.rpc("ordne_promoter_zu", {
    p_bestellung_id: bestellungId,
    p_kuerzel: eingabe.promo ?? null,
  });
  if (zuordnung) console.error("[promoter] Zuordnung fehlgeschlagen:", zuordnung.message);

  const { data: bestellung } = await db
    .from("bestellungen")
    .select("nummer, reserviert_bis, code_rabatt_cent, code_tickets")
    .eq("id", bestellungId)
    .single();

  // Der Nachweis, diese Bestellung ansehen zu dürfen. Gastkäufe haben
  // kein Konto — ohne das Cookie käme niemand an seine eigene
  // Bestätigungsseite.
  await setzeBestellCookie(bestellungId as string);

  return {
    ok: true,
    bestellung_id: bestellungId as string,
    nummer: bestellung?.nummer ?? "",
    reserviert_bis: bestellung?.reserviert_bis ?? "",
    code_rabatt_cent: (bestellung?.code_rabatt_cent as number | undefined) ?? 0,
    code_tickets: (bestellung?.code_tickets as number | undefined) ?? 0,
  };
}

/**
 * Der Kauf über ein Warteliste-Angebot. Reserviert ist schon (0020) — hier
 * kommen nur Name und Telefon dazu, und der Browser bekommt den Nachweis,
 * die Bestellung bezahlen zu dürfen. Ab da läuft alles wie bei jedem Kauf.
 */
export async function uebernimmAngebot(eingabe: {
  token: string;
  vorname: string;
  nachname: string;
  telefon?: string;
}): Promise<ReservierungErgebnis> {
  const angebot = await holeWartelisteEintrag(eingabe.token);
  if (!angebot || angebot.zustand !== "angeboten" || !angebot.bestellung) {
    return { ok: false, fehler: "angebot_vorbei" };
  }

  const db = dienstClient();
  const { error: kunde } = await db
    .from("kunden")
    .update({
      vorname: eingabe.vorname.trim() || null,
      nachname: eingabe.nachname.trim() || null,
      ...(eingabe.telefon?.trim() ? { telefon: eingabe.telefon.trim() } : {}),
    })
    .eq("id", angebot.bestellung.kundeId);
  if (kunde) console.error("[warteliste] Name nicht übernommen:", kunde.message);

  // Dieselbe Kasse, derselbe Hinweis (§ 7 Abs. 3 UWG) — siehe oben.
  const { error: hinweis } = await db
    .from("bestellungen")
    .update({ werbehinweis: true })
    .eq("id", angebot.bestellung.id);
  if (hinweis) console.error("[bestellung] Werbehinweis nicht vermerkt:", hinweis.message);

  await setzeBestellCookie(angebot.bestellung.id);

  return {
    ok: true,
    bestellung_id: angebot.bestellung.id,
    nummer: angebot.bestellung.nummer,
    reserviert_bis: angebot.bestellung.reserviertBis ?? "",
    code_rabatt_cent: 0,
    code_tickets: 0,
  };
}

/**
 * Steht der Verkauf offen, läuft der Presale, oder kommt beides erst? Und
 * hat dieser Besuch Zugang — über einen Presale-Code oder eine Einladung?
 * Wird von Eventseite und Kasse gefragt; verbindlich prüft reserviere().
 */
export async function pruefePresaleZugang(eingabe: {
  eventId: string;
  code?: string | null;
  einladung?: string | null;
}): Promise<VerkaufsStand> {
  const db = dienstClient();
  const code = eingabe.code ? normalisiereCode(eingabe.code) : null;
  // Nur wer einen Code mitbringt, zählt: Ohne Code fragt jede Eventseite hier
  // an, das wäre bloßes Surfen (0032).
  if (code && !(await darfAnschluss("codes", GRENZEN.codes))) {
    return pruefePresaleZugang({ eventId: eingabe.eventId });
  }
  const { data, error } = await db.rpc("pruefe_presale_zugang", {
    p_event_id: eingabe.eventId,
    p_code: code && CODE_MUSTER.test(code) ? code : null,
    p_einladung: eingabe.einladung && /^[0-9a-f]{32,128}$/.test(eingabe.einladung)
      ? eingabe.einladung
      : null,
  });
  if (error || !data) {
    // Im Zweifel offen anzeigen: Die Reservierung prüft ohnehin selbst, und
    // eine gesperrte Seite wegen eines Abfragefehlers wäre schlimmer.
    console.error("[presale] Prüfen fehlgeschlagen:", error?.message);
    return { verkauf: "offen" };
  }
  return data as VerkaufsStand;
}

/**
 * Sagt der Kasse, ob ein Code gilt und wie viel er für diese Auswahl
 * ausmacht. Läuft auf dem Server, weil die Datenbankfunktion nur dem
 * Dienstschlüssel offensteht — öffentlich ließen sich Codes sonst in Serie
 * durchprobieren.
 */
export async function pruefeRabattcode(eingabe: {
  eventId: string;
  code: string;
  auswahl: Auswahlposten[];
  fastlane?: number;
}): Promise<CodeVorschau> {
  const code = normalisiereCode(eingabe.code);
  if (!CODE_MUSTER.test(code)) return { ergebnis: "unbekannt" };
  // Gegen Durchprobieren (0032). Abgewiesen sieht aus wie ein falscher Code.
  if (!(await darfAnschluss("codes", GRENZEN.codes))) return { ergebnis: "unbekannt" };

  const db = dienstClient();
  const { data, error } = await db.rpc("pruefe_rabattcode", {
    p_code: code,
    p_event_id: eingabe.eventId,
    p_auswahl: eingabe.auswahl,
    p_fastlane: Math.max(0, Math.floor(eingabe.fastlane ?? 0)),
  });

  if (error || !data) {
    console.error("[rabattcode] Prüfen fehlgeschlagen:", error?.message);
    return { ergebnis: "unbekannt" };
  }
  return data as CodeVorschau;
}

/**
 * Schließt eine Bestellung ab, die dank Rabattcode nichts kostet. Über 0 €
 * lässt sich bei Stripe nichts abbuchen, also gibt es nichts abzuwarten.
 *
 * Geprüft wird alles, was einen Missbrauch verhindert: Die Bestellung
 * gehört dem Browser (Cookie), kostet laut Datenbank wirklich 0 €, und das
 * liegt an einem Code — nicht an einer Phase ohne Preis.
 */
export async function schliesseKostenlosAb(
  bestellungId: string,
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  if (!(await bestellCookieGilt(bestellungId))) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select("status, gesamt_cent, code_rabatt_cent, reserviert_bis, vorkasse")
    .eq("id", bestellungId)
    .single();

  if (!bestellung) return { ok: false, fehler: "unbekannt" };
  if (bestellung.status === "bezahlt") return { ok: true };
  if (
    bestellung.status !== "offen" ||
    bestellung.vorkasse ||
    (bestellung.gesamt_cent as number) !== 0 ||
    (bestellung.code_rabatt_cent as number) <= 0
  ) {
    return { ok: false, fehler: "nicht_kostenlos" };
  }
  if (
    bestellung.reserviert_bis &&
    new Date(bestellung.reserviert_bis as string) < new Date()
  ) {
    return { ok: false, fehler: "abgelaufen" };
  }

  const { error } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "frei",
    p_referenz: "rabattcode",
  });
  if (error) return { ok: false, fehler: error.message };

  await verschickeTickets(bestellungId);
  return { ok: true };
}

/**
 * Solange keine Zahlungsanbieter eingerichtet sind, lässt sich der Kauf
 * hiermit abschließen — ausdrücklich als Testweg erkennbar (Zahlungsart
 * "frei"). Sobald Stripe oder PayPal Schlüssel haben, verweigert die
 * Funktion den Dienst: ab da muss echtes Geld fließen.
 */
export async function schliesseTestkaufAb(
  bestellungId: string,
): Promise<{ ok: boolean; nummer?: string; fehler?: string }> {
  if (process.env.STRIPE_SECRET_KEY || process.env.PAYPAL_CLIENT_SECRET) {
    return { ok: false, fehler: "zahlung_eingerichtet" };
  }

  if (!(await bestellCookieGilt(bestellungId))) {
    return { ok: false, fehler: "nicht_deine_bestellung" };
  }

  const db = dienstClient();
  const { error } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "frei",
    p_referenz: "testkauf",
  });

  if (error) return { ok: false, fehler: error.message };

  await verschickeTickets(bestellungId);

  const { data } = await db
    .from("bestellungen")
    .select("nummer")
    .eq("id", bestellungId)
    .single();

  return { ok: true, nummer: data?.nummer };
}

export type NachbuchungErgebnis =
  | { ok: true; bestellung_id: string; reserviert_bis: string; betrag_cent: number }
  | { ok: false; fehler: "zu" | "voll" | "menge" | "unbekannt"; rest?: number };

/**
 * Garderobe auf der Ticketseite nachbuchen (0027). Der Nachweis ist der
 * Ticketlink — wer ihn hat, hat auch die Tickets. Die Nachbuchung ist eine
 * eigene Bestellung mit eigener Zahlung, bezahlt über
 * `starteZahlungNachbuchung` — auch dort ist der Ticketlink der Nachweis.
 *
 * Nur mit Stripe: Ohne Zahlungsanbieter gibt es nichts nachzubuchen, und
 * die Ticketseite bietet es dann auch nicht an.
 */
export async function bucheGarderobeNach(
  token: string,
  anzahl: number,
): Promise<NachbuchungErgebnis> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, fehler: "unbekannt" };
  if (!stripeEingerichtet()) return { ok: false, fehler: "zu" };
  const menge = Math.floor(anzahl);
  if (!(menge >= 1 && menge <= 40)) return { ok: false, fehler: "menge" };
  // Die „2 je Ticket"-Grenze deckelt das schon, aber ohne Bremse ließe sich
  // die Nachbuchung in Serie anlegen (0032).
  if (!(await darfAnschluss("zahlung", GRENZEN.zahlung))) return { ok: false, fehler: "zu" };

  const db = dienstClient();
  const { data: id, error } = await db.rpc("reserviere_garderobe", {
    p_token: token,
    p_anzahl: menge,
  });

  if (error) {
    const m = error.message;
    const rest = Number(m.match(/GARDEROBE_[A-Z_]+:(\d+)/)?.[1] ?? 0);
    if (m.includes("GARDEROBE_MENGE")) return { ok: false, fehler: "menge", rest };
    if (m.includes("GARDEROBE_AUSVERKAUFT")) return { ok: false, fehler: "voll", rest };
    if (m.includes("GARDEROBE_NICHT_VERFUEGBAR") || m.includes("EVENT_VORBEI")) {
      return { ok: false, fehler: "zu" };
    }
    console.error("[garderobe] Nachbuchen fehlgeschlagen:", m);
    return { ok: false, fehler: "unbekannt" };
  }

  const { data: bestellung } = await db
    .from("bestellungen")
    .select("reserviert_bis, gesamt_cent")
    .eq("id", id as string)
    .single();

  // Bewusst kein Cookie: Bezahlt wird über `starteZahlungNachbuchung`, mit
  // dem Ticketlink als Nachweis (siehe dort, warum).
  return {
    ok: true,
    bestellung_id: id as string,
    reserviert_bis: (bestellung?.reserviert_bis as string | undefined) ?? "",
    betrag_cent: (bestellung?.gesamt_cent as number | undefined) ?? 0,
  };
}

/** Liest die Bestellung, deren Nachweis im Cookie liegt. */
export async function holeEigeneBestellung(bestellungId: string) {
  if (!(await bestellCookieGilt(bestellungId))) return null;

  const db = dienstClient();
  const { data } = await db
    .from("bestellungen")
    .select(
      `id, nummer, status, summe_cent, gebuehr_cent, gesamt_cent, bezahlt_am,
       reserviert_bis, zugangstoken, event_id, vorkasse, rabatt_cent, rabattcode, code_rabatt_cent,
       garderobe_menge, garderobe_preis_cent,
       kunde:kunden(email, vorname, nachname),
       positionen:bestellpositionen(phase_name, menge, einzelpreis_cent, gebuehr_cent),
       event:events(slug, titel, beginn, ort:orte(name, stadt))`,
    )
    .eq("id", bestellungId)
    .single();

  return data;
}

/**
 * Fängt das Wettrennen zwischen Rückleitung und Webhook ab.
 *
 * Stripe schickt den Gast sofort zurück, der Webhook braucht manchmal ein
 * paar Sekunden länger. Ohne das hier stünde auf der Bestätigungsseite
 * "keine Tickets", obwohl bezahlt wurde. Also fragen wir im Zweifel selbst
 * bei Stripe nach. `bestaetige_zahlung` ist mehrfach aufrufbar — wenn der
 * Webhook kurz darauf doch noch kommt, entstehen keine zweiten Tickets.
 */
export async function stelleZahlungSicher(bestellungId: string): Promise<void> {
  if (!stripeEingerichtet()) return;

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select("status, zahlung_ref")
    .eq("id", bestellungId)
    .single();

  if (!bestellung || bestellung.status !== "offen") return;

  const referenz = bestellung.zahlung_ref as string | null;
  if (!referenz?.startsWith("pi_")) return;

  try {
    const absicht = await stripe().paymentIntents.retrieve(referenz);
    if (absicht.status !== "succeeded") return;

    const { error } = await db.rpc("bestaetige_zahlung", {
      p_bestellung_id: bestellungId,
      p_zahlungsart: "stripe",
      p_referenz: absicht.id,
      p_erwartet_cent: absicht.amount_received ?? absicht.amount,
    });
    if (error) console.error("[zahlung] Nachtrag fehlgeschlagen:", error.message);
    else await verschickeTickets(bestellungId);
  } catch (fehler) {
    console.error("[zahlung] Stripe nicht erreichbar:", (fehler as Error).message);
  }
}
