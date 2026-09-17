/**
 * Prüft die Promoter-Zuordnung und die Statistik an der echten Datenbank.
 *
 *   node scripts/promoter-testen.mjs
 *
 * Legt ein Test-Event ("test-promoter-…"), zwei Promoter und einen Code an,
 * spielt Reservierungen durch und räumt am Ende alles wieder weg — auch
 * wenn unterwegs etwas schiefgeht. Das Event ist für wenige Sekunden
 * veröffentlicht, weil reserviere() nur veröffentlichte Events annimmt.
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

const KENNUNG = Date.now().toString(36);
const MAIL = `promotertest-${KENNUNG}@lunar-events.de`;
const angelegt = { eventId: null, promoterIds: [], codeIds: [] };

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function promoter(name, felder = {}) {
  const { data, error } = await db
    .from("promoter")
    .insert({ name, kuerzel: `t${KENNUNG}-${name.toLowerCase()}`, ...felder })
    .select("*")
    .single();
  if (error) throw new Error(`Promoter ${name}: ${error.message}`);
  angelegt.promoterIds.push(data.id);
  return data;
}

async function reserviere(phaseId, menge, code = null) {
  const { data, error } = await db.rpc("reserviere", {
    p_event_id: angelegt.eventId,
    p_auswahl: [{ phase_id: phaseId, menge }],
    p_email: MAIL,
    p_code: code,
  });
  if (error) throw new Error(`Reservierung: ${error.message}`);
  return data;
}

async function zuordnen(bestellungId, kuerzel) {
  const { data, error } = await db.rpc("ordne_promoter_zu", {
    p_bestellung_id: bestellungId,
    p_kuerzel: kuerzel,
  });
  if (error) throw new Error(`Zuordnung: ${error.message}`);
  return data;
}

async function durchspielen() {
  const { data: ort } = await db.from("orte").select("id").limit(1).single();
  const { data: event, error: evFehler } = await db
    .from("events")
    .insert({
      slug: `test-promoter-${KENNUNG}`,
      titel: "TEST PROMOTER",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 20 * 86400000).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (evFehler) throw new Error(`Event: ${evFehler.message}`);
  angelegt.eventId = event.id;

  const { data: phase, error: phFehler } = await db
    .from("phasen")
    .insert({ event_id: event.id, name: "Early", art: "standard", preis_cent: 1000,
              gebuehr_cent: 100, kontingent: 50, verkauft: 0, position: 1, aktiv: true,
              leistungen: [] })
    .select("id")
    .single();
  if (phFehler) throw new Error(`Phase: ${phFehler.message}`);

  const max = await promoter("Max");
  const lisa = await promoter("Lisa");
  const pause = await promoter("Pause", { aktiv: false });

  const { data: code, error: cFehler } = await db
    .from("rabattcodes")
    .insert({ code: `TP${KENNUNG.toUpperCase()}`, art: "prozent", wert: 10, promoter_id: lisa.id })
    .select("id, code")
    .single();
  if (cFehler) throw new Error(`Code: ${cFehler.message}`);
  angelegt.codeIds.push(code.id);

  console.log("\n— Zuordnung —");
  const b1 = await reserviere(phase.id, 2);
  pruefe((await zuordnen(b1, ` ${max.kuerzel.toUpperCase()} `)) === max.id,
    "Link-Kürzel ordnet zu, Schreibweise egal");

  const b2 = await reserviere(phase.id, 1, code.code);
  pruefe((await zuordnen(b2, max.kuerzel)) === lisa.id,
    "Code schlägt Link: Lisas Code über Max' Link zählt für Lisa");

  const b3 = await reserviere(phase.id, 1, code.code);
  pruefe((await zuordnen(b3, null)) === lisa.id, "Code allein ordnet zu");

  const b4 = await reserviere(phase.id, 1);
  pruefe((await zuordnen(b4, pause.kuerzel)) === null, "Pausierter Promoter zählt nicht");
  pruefe((await zuordnen(b4, "gibt-es-nicht")) === null, "Unbekanntes Kürzel zählt nicht");

  pruefe((await zuordnen(b1, lisa.kuerzel)) === max.id,
    "Eine gesetzte Zuordnung wird nicht überschrieben");

  console.log("\n— Statistik —");
  await db.from("ereignisse").insert([
    { art: "event_gesehen", event_id: event.id, promoter_id: max.id, quelle: "direkt", geraet: "mobil" },
    { art: "event_gesehen", event_id: event.id, promoter_id: max.id, quelle: "direkt", geraet: "mobil" },
    { art: "kasse_begonnen", event_id: event.id, promoter_id: max.id, quelle: "intern", geraet: "mobil" },
  ]);

  const { data: vorher } = await db.rpc("promoter_statistik", { p_token: max.token });
  const zeileVorher = vorher?.events?.find((e) => e.id === event.id);
  pruefe(zeileVorher?.klicks === 2 && zeileVorher?.tickets === 0,
    "Klicks zählen nur Eventaufrufe, offene Bestellungen keine Tickets",
    `${zeileVorher?.klicks} Klicks, ${zeileVorher?.tickets} Tickets`);

  await db.rpc("bestaetige_zahlung", { p_bestellung_id: b1, p_zahlungsart: "frei", p_referenz: "promotertest" });
  const { data: nachher } = await db.rpc("promoter_statistik", { p_token: max.token });
  const zeile = nachher?.events?.find((e) => e.id === event.id);
  pruefe(zeile?.tickets === 2, "Bezahlte Tickets zählen", `${zeile?.tickets}`);
  pruefe(nachher?.name === "Max" && !("token" in (nachher ?? {})), "Name ja, Token nicht in der Antwort");
  pruefe(!JSON.stringify(nachher).includes(MAIL), "Keine Kundendaten in der Antwort");

  const { data: lisaStat } = await db.rpc("promoter_statistik", { p_token: lisa.token });
  pruefe(lisaStat?.codes?.some((c) => c.code === code.code), "Lisa sieht ihren Code");
  pruefe(lisaStat?.events?.find((e) => e.id === event.id)?.tickets === 0,
    "Lisas offene Reservierungen zählen noch nicht");

  const { data: falsch } = await db.rpc("promoter_statistik", { p_token: "x".repeat(64) });
  pruefe(falsch === null, "Falscher Token: keine Antwort");

  console.log("\n— Rechte —");
  const { error: anonStat } = await oeffentlich.rpc("promoter_statistik", { p_token: max.token });
  pruefe(Boolean(anonStat), "Öffentlicher Schlüssel kann Tokens nicht durchprobieren", anonStat?.message ?? "");
  const { error: anonZu } = await oeffentlich.rpc("ordne_promoter_zu", { p_bestellung_id: b4, p_kuerzel: max.kuerzel });
  pruefe(Boolean(anonZu), "Öffentlicher Schlüssel kann nichts zuordnen");
  const { data: anonLesen } = await oeffentlich.from("promoter").select("token");
  pruefe((anonLesen ?? []).length === 0, "Öffentlicher Schlüssel sieht keine Promoter");
}

async function aufraeumen() {
  if (angelegt.eventId) {
    const { data: bestellungen } = await db
      .from("bestellungen").select("id").eq("event_id", angelegt.eventId);
    const ids = (bestellungen ?? []).map((b) => b.id);
    if (ids.length > 0) {
      await db.from("tickets").delete().in("bestellung_id", ids);
      await db.from("bestellpositionen").delete().in("bestellung_id", ids);
      await db.from("bestellungen").delete().in("id", ids);
    }
    await db.from("ereignisse").delete().eq("event_id", angelegt.eventId);
  }
  if (angelegt.codeIds.length > 0) await db.from("rabattcodes").delete().in("id", angelegt.codeIds);
  if (angelegt.promoterIds.length > 0) {
    await db.from("ereignisse").delete().in("promoter_id", angelegt.promoterIds);
    await db.from("promoter").delete().in("id", angelegt.promoterIds);
  }
  if (angelegt.eventId) {
    await db.from("phasen").delete().eq("event_id", angelegt.eventId);
    await db.from("events").delete().eq("id", angelegt.eventId);
  }
  await db.from("kunden").delete().eq("email", MAIL);

  const zaehle = async (tabelle, spalte, wert) =>
    (await db.from(tabelle).select("id", { count: "exact", head: true }).like(spalte, wert)).count;
  const rest = [
    await zaehle("events", "slug", `test-promoter-${KENNUNG}`),
    await zaehle("promoter", "kuerzel", `t${KENNUNG}-%`),
    await zaehle("rabattcodes", "code", `TP${KENNUNG.toUpperCase()}`),
    await zaehle("kunden", "email", MAIL),
  ];
  const sauber = rest.every((n) => n === 0);
  console.log(`\nAufgeräumt: ${sauber ? "Event, Promoter, Code und Testkunde weg" : `NOCH DA: ${rest.join("/")}`}`);
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
