/**
 * Prüft die Rabattcodes an der echten Datenbank, ohne Browser.
 *
 *   node scripts/rabattcodes-testen.mjs
 *
 * Legt ein Test-Event (Slug "test-rabatt-…") mit zwei Phasen und ein paar
 * Codes an, spielt Reservierungen durch und räumt am Ende alles wieder weg
 * — auch wenn unterwegs etwas schiefgeht. Das Event ist für die Dauer des
 * Laufs (wenige Sekunden) veröffentlicht, weil reserviere() nur
 * veröffentlichte Events annimmt.
 *
 * Geprüft wird, was die Selbstprüfung der Migration nicht sehen kann: das
 * Zusammenspiel mit Reservierung, Sperren, Verfall und Vorkasse.
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

const KENNUNG = Date.now().toString(36).toUpperCase();
const MAILS = ["a", "b", "c"].map((x) => `rabatttest-${x}-${KENNUNG.toLowerCase()}@lunar-events.de`);

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

const angelegt = { eventId: null, codeIds: [] };

async function code(felder) {
  const { data, error } = await db
    .from("rabattcodes")
    .insert({ code: `T${KENNUNG}${felder.name}`, ...felder, name: undefined })
    .select("*")
    .single();
  if (error) throw new Error(`Code ${felder.name}: ${error.message}`);
  angelegt.codeIds.push(data.id);
  return data;
}

async function reserviere(email, menge, codeText, phaseId) {
  const { data, error } = await db.rpc("reserviere", {
    p_event_id: angelegt.eventId,
    p_auswahl: [{ phase_id: phaseId, menge }],
    p_email: email,
    p_code: codeText,
  });
  if (error) return { fehler: error.message };
  const { data: b } = await db
    .from("bestellungen")
    .select("id, summe_cent, gebuehr_cent, gesamt_cent, code_rabatt_cent, code_tickets, rabattcode")
    .eq("id", data)
    .single();
  return b;
}

async function eingeloest(id) {
  const { data } = await db.from("rabattcodes").select("eingeloest").eq("id", id).single();
  return data.eingeloest;
}

async function durchspielen() {
  const { data: ort } = await db.from("orte").select("id").limit(1).single();
  const { data: echtesEvent } = await db
    .from("events").select("id").not("slug", "like", "test-%").limit(1).single();

  const beginn = new Date(Date.now() + 20 * 86400000).toISOString();
  const { data: event, error: evFehler } = await db
    .from("events")
    .insert({
      slug: `test-rabatt-${KENNUNG.toLowerCase()}`,
      titel: "TEST RABATT",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn,
      ort_id: ort.id,
      veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (evFehler) throw new Error(`Event: ${evFehler.message}`);
  angelegt.eventId = event.id;

  const { data: phasen, error: phFehler } = await db
    .from("phasen")
    .insert([
      { event_id: event.id, name: "Early", art: "standard", preis_cent: 1000, gebuehr_cent: 100,
        kontingent: 50, verkauft: 0, position: 1, aktiv: true, leistungen: [] },
      { event_id: event.id, name: "Spaeter", art: "standard", preis_cent: 2000, gebuehr_cent: 100,
        kontingent: 50, verkauft: 0, position: 2, aktiv: true, leistungen: [] },
    ])
    .select("id, name");
  if (phFehler) throw new Error(`Phasen: ${phFehler.message}`);
  const early = phasen.find((p) => p.name === "Early").id;
  const spaeter = phasen.find((p) => p.name === "Spaeter").id;

  console.log("\n— Prozent, an das Event gebunden —");
  const p20 = await code({ name: "P20", art: "prozent", wert: 20, event_id: event.id });
  const { data: vorschau } = await db.rpc("pruefe_rabattcode", {
    p_code: p20.code.toLowerCase(),
    p_event_id: event.id,
    p_auswahl: [{ phase_id: early, menge: 3 }],
  });
  pruefe(vorschau?.ergebnis === "ok" && vorschau.rabatt_cent === 600,
    "Vorschau: 20 % auf 3 × 10 € = 6 €, Kleinschreibung egal", JSON.stringify(vorschau));
  const r1 = await reserviere(MAILS[0], 3, ` ${p20.code.toLowerCase()} `, early);
  pruefe(r1.code_rabatt_cent === 600 && r1.gesamt_cent === 3300 - 600,
    "Reservierung rechnet gleich", `gesamt ${r1.gesamt_cent}, Rabatt ${r1.code_rabatt_cent}`);
  pruefe(r1.rabattcode === p20.code, "Code wird in die Bestellung kopiert", r1.rabattcode);
  pruefe((await eingeloest(p20.id)) === 3, "Drei Einlösungen gezählt");

  console.log("\n— Vorkasse behält den Code-Rabatt —");
  const { error: vkFehler } = await db.rpc("waehle_vorkasse", { p_bestellung_id: r1.id });
  const { data: vk } = await db
    .from("bestellungen").select("gesamt_cent, rabatt_cent").eq("id", r1.id).single();
  pruefe(!vkFehler && vk.gesamt_cent === 3000 - 600 && vk.rabatt_cent === 300,
    "Überweisung: 30 € − 6 € Code, Gebühren als Vorkasse-Rabatt", `gesamt ${vk?.gesamt_cent} ${vkFehler?.message ?? ""}`);

  console.log("\n— Fester Betrag mit Obergrenze —");
  const b5 = await code({ name: "B5", art: "betrag", wert: 500, max_tickets: 4 });
  const r2 = await reserviere(MAILS[1], 3, b5.code, early);
  pruefe(r2.code_rabatt_cent === 1500 && r2.code_tickets === 3, "3 Tickets je 5 €", `${r2.code_rabatt_cent}`);
  const r3 = await reserviere(MAILS[2], 3, b5.code, early);
  pruefe(r3.code_rabatt_cent === 500 && r3.code_tickets === 1,
    "Nur noch 1 von 3 Tickets rabattiert", `${r3.code_rabatt_cent} / ${r3.code_tickets}`);
  pruefe((await eingeloest(b5.id)) === 4, "Obergrenze erreicht");
  const r4 = await reserviere(MAILS[2], 1, b5.code, early);
  pruefe(r4.fehler?.includes("CODE_AUFGEBRAUCHT"), "Danach: aufgebraucht", r4.fehler ?? "");
  const { data: vAus } = await db.rpc("pruefe_rabattcode", {
    p_code: b5.code, p_event_id: event.id, p_auswahl: [{ phase_id: early, menge: 1 }],
  });
  pruefe(vAus?.ergebnis === "aufgebraucht", "Vorschau sagt dasselbe", vAus?.ergebnis);

  console.log("\n— Verfall gibt Einlösungen zurück —");
  await db.from("bestellungen")
    .update({ reserviert_bis: new Date(Date.now() - 60000).toISOString() })
    .in("id", [r2.id, r3.id]);
  await db.rpc("raeume_reservierungen_auf");
  pruefe((await eingeloest(b5.id)) === 0, "Nach Verfall wieder 0 eingelöst");
  pruefe((await eingeloest(p20.id)) === 3, "Vorkasse-Bestellung hält ihre Einlösungen");

  console.log("\n— Einmal je Person —");
  const einmal = await code({ name: "EINMAL", art: "prozent", wert: 10, einmal_pro_person: true });
  const e1 = await reserviere(MAILS[1], 1, einmal.code, early);
  const e2 = await reserviere(MAILS[1], 1, einmal.code, early);
  pruefe(!e1.fehler && !e2.fehler,
    "Liegen gelassene Kartenreservierung sperrt nicht", e2.fehler ?? "");
  await db.rpc("bestaetige_zahlung", { p_bestellung_id: e2.id, p_zahlungsart: "frei", p_referenz: "rabatttest" });
  const e3 = await reserviere(MAILS[1], 1, einmal.code, early);
  pruefe(e3.fehler?.includes("CODE_SCHON_GENUTZT"), "Nach Bezahlung: schon genutzt", e3.fehler ?? "");
  const e4 = await reserviere(MAILS[2], 1, einmal.code, early);
  pruefe(!e4.fehler, "Andere Adresse darf", e4.fehler ?? "");

  console.log("\n— Grenzen —");
  const nurSpaeter = await code({
    name: "PHASE", art: "prozent", wert: 50, event_id: event.id, phasen_ids: [spaeter],
  });
  const g1 = await reserviere(MAILS[0], 1, nurSpaeter.code, early);
  pruefe(g1.fehler?.includes("CODE_PASST_NICHT"), "Falsche Phase", g1.fehler ?? "");
  const vorbei = await code({
    name: "ALT", art: "prozent", wert: 50,
    gueltig_ab: new Date(Date.now() - 2 * 86400000).toISOString(),
    gueltig_bis: new Date(Date.now() - 86400000).toISOString(),
  });
  pruefe((await reserviere(MAILS[0], 1, vorbei.code, early)).fehler?.includes("CODE_ABGELAUFEN"), "Abgelaufen");
  const spaeterCode = await code({
    name: "BALD", art: "prozent", wert: 50, gueltig_ab: new Date(Date.now() + 86400000).toISOString(),
  });
  pruefe((await reserviere(MAILS[0], 1, spaeterCode.code, early)).fehler?.includes("CODE_NOCH_NICHT"), "Noch nicht gültig");
  const pause = await code({ name: "PAUSE", art: "prozent", wert: 50, aktiv: false });
  pruefe((await reserviere(MAILS[0], 1, pause.code, early)).fehler?.includes("CODE_UNBEKANNT"), "Pausiert wirkt wie unbekannt");
  const fremd = await code({ name: "FREMD", art: "prozent", wert: 50, event_id: echtesEvent.id });
  pruefe((await reserviere(MAILS[0], 1, fremd.code, early)).fehler?.includes("CODE_ANDERES_EVENT"), "Anderes Event");
  pruefe((await reserviere(MAILS[0], 1, "GIBTESNICHT", early)).fehler?.includes("CODE_UNBEKANNT"), "Unbekannter Code");
  const { data: phaseNach } = await db.from("phasen").select("verkauft").eq("id", early).single();
  const { data: offene } = await db
    .from("bestellpositionen").select("menge, bestellung:bestellungen!inner(status, event_id)")
    .eq("bestellung.event_id", event.id).in("bestellung.status", ["offen", "bezahlt"]);
  const erwartet = (offene ?? []).reduce((s, p) => s + p.menge, 0);
  pruefe(phaseNach.verkauft === erwartet,
    "Abgelehnte Codes halten keine Tickets fest", `${phaseNach.verkauft} verkauft, ${erwartet} erwartet`);

  console.log("\n— Kleinstbetrag —");
  const fast = await code({ name: "FAST", art: "prozent", wert: 96, event_id: event.id });
  const { data: ohneGebuehr } = await db.from("phasen")
    .update({ gebuehr_cent: 0 }).eq("id", early).select("id");
  pruefe(ohneGebuehr?.length === 1, "Test-Phase ohne Gebühr");
  const k1 = await reserviere(MAILS[0], 1, fast.code, early);
  pruefe(k1.gesamt_cent === 0 && k1.code_rabatt_cent === 1000,
    "96 % von 10 € ließe 40 Cent — wird erlassen", `gesamt ${k1.gesamt_cent}`);

  console.log("\n— Rechte —");
  const { error: anonPruef } = await oeffentlich.rpc("pruefe_rabattcode", {
    p_code: p20.code, p_event_id: event.id, p_auswahl: [],
  });
  pruefe(Boolean(anonPruef), "Öffentlicher Schlüssel kann Codes nicht durchprobieren", anonPruef?.message ?? "");
  const { data: anonLesen } = await oeffentlich.from("rabattcodes").select("code");
  pruefe((anonLesen ?? []).length === 0, "Öffentlicher Schlüssel sieht keine Codes");
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
  }
  if (angelegt.codeIds.length > 0) await db.from("rabattcodes").delete().in("id", angelegt.codeIds);
  if (angelegt.eventId) {
    await db.from("phasen").delete().eq("event_id", angelegt.eventId);
    await db.from("events").delete().eq("id", angelegt.eventId);
  }
  await db.from("kunden").delete().in("email", MAILS);

  const { count: restEvent } = await db
    .from("events").select("id", { count: "exact", head: true }).eq("id", angelegt.eventId ?? "00000000-0000-0000-0000-000000000000");
  const { count: restCodes } = await db
    .from("rabattcodes").select("id", { count: "exact", head: true }).like("code", `T${KENNUNG}%`);
  const { count: restKunden } = await db
    .from("kunden").select("id", { count: "exact", head: true }).in("email", MAILS);
  console.log(
    `\nAufgeräumt: Event ${restEvent === 0 ? "weg" : "NOCH DA"}, Codes ${restCodes === 0 ? "weg" : "NOCH DA"}, Testkunden ${restKunden === 0 ? "weg" : "NOCH DA"}`,
  );
  if (restEvent || restCodes || restKunden) process.exitCode = 1;
}

try {
  await durchspielen();
} catch (fehler) {
  console.error("\nAbgebrochen:", fehler.message ?? fehler);
  process.exitCode = 1;
} finally {
  await aufraeumen();
}
