/**
 * Prüft die Warteliste an der echten Datenbank.
 *
 *   node scripts/warteliste-testen.mjs
 *
 * Legt ein Test-Event an ("test-warteliste-…") mit zwei kleinen Phasen,
 * verkauft es aus, lässt Reservierungen verfallen und spielt Angebote,
 * Freigeben, Frist und Kauf durch. Räumt am Ende alles wieder weg — auch
 * wenn unterwegs etwas schiefgeht. Mails werden hier keine verschickt; die
 * Adressen enden auf .invalid, damit auch ein zufällig dazwischen laufender
 * Takt niemanden anschreibt.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const oeffentlich = createClient(
  URL_,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

const K = Date.now().toString(36);
const mail = (name) => `wartetest-${name}-${K}@example.invalid`;
const NAMEN = ["k1", "k2", "k3", "k4", "e1", "e2", "e3", "e5"];
const MAILS = Object.fromEntries(NAMEN.map((n) => [n, mail(n)]));
let eventId = null;
const stunde = 3600000;

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function rpc(name, argumente) {
  const { data, error } = await db.rpc(name, argumente);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function reserviere(phase, email, menge = 1) {
  return rpc("reserviere", {
    p_event_id: eventId,
    p_auswahl: [{ phase_id: phase, menge }],
    p_email: email,
  });
}

/** Lässt eine Reservierung verfallen und räumt auf — wie der Takt. */
async function lassVerfallen(bestellungId) {
  await db.from("bestellungen")
    .update({ reserviert_bis: new Date(Date.now() - 60000).toISOString() })
    .eq("id", bestellungId);
  await rpc("raeume_reservierungen_auf");
}

async function eintrag(name) {
  const { data } = await db.from("warteliste")
    .select("id, token, anzahl, bestaetigt_am, angebot_am, angebot_verschickt_am, ausgetragen_am, bestellung_id")
    .eq("event_id", eventId).eq("email", MAILS[name])
    .order("erstellt_am", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function positionen(bestellungId) {
  const { data } = await db.from("bestellpositionen")
    .select("phase_id, menge").eq("bestellung_id", bestellungId);
  return data ?? [];
}

async function durchspielen() {
  const { data: ort } = await db.from("orte").select("id").limit(1).single();
  const beginn = new Date(Date.now() + 20 * 24 * stunde).toISOString();
  const { data: ev, error } = await db.from("events").insert({
    slug: `test-warteliste-${K}`, titel: "TEST WARTELISTE", kategorie: "club",
    status: "veroeffentlicht", beginn, ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (error) throw new Error(`Event: ${error.message}`);
  eventId = ev.id;

  const phase = async (name, position) => {
    const { data, error: pf } = await db.from("phasen").insert({
      event_id: eventId, name, art: "standard", preis_cent: 1000, gebuehr_cent: 100,
      kontingent: 2, verkauft: 0, position, aktiv: true, leistungen: [],
    }).select("id").single();
    if (pf) throw new Error(`Phase ${name}: ${pf.message}`);
    return data.id;
  };
  const A = await phase("A", 1);
  const B = await phase("B", 2);

  console.log("\n— Eintragen —");
  let antwort = await rpc("trage_in_warteliste", {
    p_event_id: eventId, p_email: MAILS.e1, p_vorname: "Eins", p_anzahl: 2,
  });
  pruefe(antwort.ergebnis === "nicht_ausverkauft", "Nicht ausverkauft: keine Warteliste", antwort.ergebnis);

  const k1 = await reserviere(A, MAILS.k1);
  await rpc("bestaetige_zahlung", { p_bestellung_id: k1, p_zahlungsart: "frei", p_referenz: "wartetest" });
  const k2 = await reserviere(A, MAILS.k2);
  const k3 = await reserviere(B, MAILS.k3);
  const k4 = await reserviere(B, MAILS.k4);

  antwort = await rpc("trage_in_warteliste", {
    p_event_id: eventId, p_email: MAILS.e1.toUpperCase(), p_vorname: "Eins", p_anzahl: 2,
  });
  pruefe(antwort.ergebnis === "neu" && /^[0-9a-f]{64}$/.test(antwort.token), "Ausverkauft: Eintrag angelegt");
  await db.from("warteliste").update({ bestaetigung_verschickt_am: new Date().toISOString() }).eq("id", antwort.id);
  const nochmal = await rpc("trage_in_warteliste", {
    p_event_id: eventId, p_email: MAILS.e1, p_vorname: null, p_anzahl: 2,
  });
  pruefe(nochmal.ergebnis === "mail_unterwegs", "Zweites Absenden kurz danach: keine zweite Mail", nochmal.ergebnis);

  const e2 = await rpc("trage_in_warteliste", { p_event_id: eventId, p_email: MAILS.e2, p_vorname: null, p_anzahl: 1 });
  const e3 = await rpc("trage_in_warteliste", { p_event_id: eventId, p_email: MAILS.e3, p_vorname: null, p_anzahl: 1 });
  const zuViel = await rpc("trage_in_warteliste", { p_event_id: eventId, p_email: mail("x"), p_vorname: null, p_anzahl: 5 });
  pruefe(zuViel.ergebnis === "anzahl", "Mehr als 4 Tickets abgelehnt");

  // Reihenfolge zählt ab Bestätigung: erst e1, dann e2. e3 bestätigt nie.
  const b1 = await rpc("bestaetige_warteliste", { p_token: antwort.token });
  await new Promise((r) => setTimeout(r, 50));
  await rpc("bestaetige_warteliste", { p_token: e2.token });
  pruefe(b1 === eventId, "Bestätigen liefert die Event-ID");
  const schon = await rpc("trage_in_warteliste", { p_event_id: eventId, p_email: MAILS.e1, p_vorname: null, p_anzahl: 2 });
  pruefe(schon.ergebnis === "schon_drauf", "Bestätigte Adresse: schon drauf");

  console.log("\n— Wer passt, rückt vor —");
  await lassVerfallen(k3);
  let neu = await rpc("bediene_warteliste", { p_event_id: eventId });
  let s1 = await eintrag("e1");
  let s2 = await eintrag("e2");
  let s3 = await eintrag("e3");
  pruefe(neu === 1 && s2.angebot_am && !s1.angebot_am,
    "1 Platz frei: e2 (will 1) bekommt ihn, e1 (will 2) bleibt vorne", `neu=${neu}`);
  pruefe(!s3.angebot_am, "Unbestätigter Eintrag bekommt nichts");
  const pos2 = await positionen(s2.bestellung_id);
  pruefe(pos2.length === 1 && pos2[0].phase_id === B && pos2[0].menge === 1, "Angebot von e2 hält den freien Platz in B");
  const { data: best2 } = await db.from("bestellungen").select("reserviert_bis, status").eq("id", s2.bestellung_id).single();
  const vorlauf = new Date(best2.reserviert_bis).getTime() - Date.now();
  pruefe(best2.status === "offen" && vorlauf > 23 * stunde && vorlauf <= 24 * stunde + 60000,
    "Bis zum Versand hält das Angebot einen Tag", best2.reserviert_bis);

  console.log("\n— Versand und Frist —");
  const geholt = await rpc("beanspruche_angebote", { p_event_id: eventId, p_grenze: 50 });
  const erwartet = await rpc("angebot_frist", { p_ab: new Date().toISOString(), p_beginn: beginn });
  pruefe(geholt.length === 1 && geholt[0].email === MAILS.e2 && geholt[0].event_titel === "TEST WARTELISTE",
    "Beanspruchen liefert das Angebot mit allem für die Mail");
  pruefe(Math.abs(new Date(geholt[0].reserviert_bis) - new Date(erwartet)) < 10000,
    "Mit dem Versand beginnt die Frist (4 Std, nachts bis 10 Uhr)", geholt[0].reserviert_bis);
  const doppelt = await rpc("beanspruche_angebote", { p_event_id: eventId, p_grenze: 50 });
  pruefe(doppelt.length === 0, "Ein beanspruchtes Angebot wird kein zweites Mal geholt");
  await rpc("angebot_nicht_zugestellt", { p_id: geholt[0].id });
  s2 = await eintrag("e2");
  const { data: zurueck } = await db.from("bestellungen").select("reserviert_bis").eq("id", s2.bestellung_id).single();
  pruefe(!s2.angebot_verschickt_am &&
    Math.abs(new Date(zurueck.reserviert_bis) - (new Date(s2.angebot_am).getTime() + 24 * stunde)) < 2000,
    "Nicht zugestellt: wieder offen, Frist zurück auf einen Tag nach dem Angebot");
  await rpc("beanspruche_angebote", { p_event_id: eventId, p_grenze: 50 });

  await lassVerfallen(k2);
  neu = await rpc("bediene_warteliste", { p_event_id: eventId });
  pruefe(neu === 0 && !(await eintrag("e1")).angebot_am, "Wieder nur 1 Platz frei (in A): e1 wartet weiter");

  console.log("\n— Freigeben —");
  const frei = await rpc("trage_aus_warteliste", { p_token: e2.token });
  const { data: best2b } = await db.from("bestellungen").select("status").eq("id", s2.bestellung_id).single();
  pruefe(frei === eventId && best2b.status === "abgelaufen", "Freigeben gibt die Reservierung sofort zurück", best2b.status);
  neu = await rpc("bediene_warteliste", { p_event_id: eventId });
  s1 = await eintrag("e1");
  const pos1 = s1.bestellung_id ? await positionen(s1.bestellung_id) : [];
  pruefe(neu === 1 && pos1.length === 2 && pos1.every((p) => p.menge === 1),
    "Jetzt 2 frei (A und B): e1 bekommt beide, über zwei Phasen hinweg", JSON.stringify(pos1.map((p) => p.phase_id === A ? "A" : "B")));
  const nochmalFrei = await rpc("trage_aus_warteliste", { p_token: e2.token });
  pruefe(nochmalFrei === eventId, "Zweimal freigeben schadet nicht");

  const wieder = await rpc("trage_in_warteliste", { p_event_id: eventId, p_email: MAILS.e2, p_vorname: null, p_anzahl: 1 });
  pruefe(wieder.ergebnis === "neu" && wieder.token !== e2.token, "Nach dem Freigeben darf man sich neu eintragen — hinten");

  console.log("\n— Kaufen —");
  await rpc("bestaetige_zahlung", { p_bestellung_id: s1.bestellung_id, p_zahlungsart: "frei", p_referenz: "wartetest" });
  const kaufFrei = await rpc("trage_aus_warteliste", { p_token: antwort.token });
  pruefe(kaufFrei === null, "Wer bezahlt hat, kann nichts mehr freigeben");
  const { count: tickets } = await db.from("tickets").select("id", { count: "exact", head: true }).eq("bestellung_id", s1.bestellung_id);
  pruefe(tickets === 2, "Tickets für e1 ausgestellt", String(tickets));

  console.log("\n— Presale —");
  await db.from("events").update({
    presale_ab: new Date(Date.now() - stunde).toISOString(),
    verkauf_ab: new Date(Date.now() + stunde).toISOString(),
  }).eq("id", eventId);
  const e5 = await rpc("trage_in_warteliste", { p_event_id: eventId, p_email: MAILS.e5, p_vorname: null, p_anzahl: 1 });
  await rpc("bestaetige_warteliste", { p_token: e5.token });
  await lassVerfallen(k4);
  neu = await rpc("bediene_warteliste", { p_event_id: eventId });
  pruefe(neu === 0, "Während des Presale verteilt die Warteliste nichts");
  await db.from("events").update({ presale_ab: null, verkauf_ab: null }).eq("id", eventId);
  neu = await rpc("bediene_warteliste", { p_event_id: eventId });
  pruefe(neu === 1 && (await eintrag("e5")).angebot_am, "Nach dem Presale bekommt e5 den Platz");

  console.log("\n— Rechte —");
  const aufrufe = await Promise.all([
    oeffentlich.rpc("trage_in_warteliste", { p_event_id: eventId, p_email: "x@y.de", p_vorname: null, p_anzahl: 1 }),
    oeffentlich.rpc("bediene_warteliste", { p_event_id: eventId }),
    oeffentlich.rpc("beanspruche_angebote", { p_event_id: eventId }),
    oeffentlich.rpc("trage_aus_warteliste", { p_token: e5.token }),
    oeffentlich.rpc("lunar_takt"),
  ]);
  pruefe(aufrufe.every((a) => a.error), "Öffentlicher Schlüssel kann keine Warteliste-Funktion aufrufen");
  const { data: lesen } = await oeffentlich.from("warteliste").select("token").eq("event_id", eventId);
  const { data: geheim } = await oeffentlich.from("betrieb").select("wert");
  pruefe((lesen ?? []).length === 0 && (geheim ?? []).length === 0,
    "Öffentlicher Schlüssel sieht weder Einträge noch Betriebswerte");
}

async function aufraeumen() {
  if (eventId) {
    const { data: bestellungen } = await db.from("bestellungen").select("id").eq("event_id", eventId);
    const ids = (bestellungen ?? []).map((b) => b.id);
    await db.from("warteliste").delete().eq("event_id", eventId);
    if (ids.length > 0) {
      await db.from("tickets").delete().in("bestellung_id", ids);
      await db.from("bestellpositionen").delete().in("bestellung_id", ids);
      await db.from("bestellungen").delete().in("id", ids);
    }
    await db.from("phasen").delete().eq("event_id", eventId);
    await db.from("events").delete().eq("id", eventId);
  }
  await db.from("kunden").delete().like("email", `wartetest-%-${K}@example.invalid`);

  const zaehle = async (tabelle, spalte, muster) =>
    (await db.from(tabelle).select("id", { count: "exact", head: true }).like(spalte, muster)).count;
  const rest = [
    await zaehle("events", "slug", `test-warteliste-${K}`),
    await zaehle("warteliste", "email", `wartetest-%-${K}@example.invalid`),
    await zaehle("kunden", "email", `wartetest-%-${K}@example.invalid`),
  ];
  const sauber = rest.every((n) => n === 0);
  console.log(`\nAufgeräumt: ${sauber ? "Event, Einträge, Bestellungen und Testkunden weg" : `NOCH DA: ${rest.join("/")}`}`);
  if (!sauber) process.exitCode = 1;
}

try {
  await durchspielen();
} catch (fehler) {
  console.error("\nAbgebrochen:", fehler.message ?? fehler);
  process.exitCode = 1;
} finally {
  await aufraeumen();
}
