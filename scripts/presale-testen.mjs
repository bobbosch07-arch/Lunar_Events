/**
 * Prüft Presale, Einladungen und Abmelden an der echten Datenbank.
 *
 *   node scripts/presale-testen.mjs
 *
 * Legt zwei Test-Events an ("test-presale-…"): ein früheres, für das Gäste
 * bezahlt haben, und eines im Presale. Spielt Reservierungen durch und
 * räumt am Ende alles wieder weg — auch wenn unterwegs etwas schiefgeht.
 * Mails werden hier keine verschickt; das macht die Serveraktion.
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
const mail = (name) => `presaletest-${name}-${K}@lunar-events.de`;
const MAILS = ["gast", "ohnehinweis", "abgemeldet", "neu", "freund"].map(mail);
const angelegt = { events: [], codes: [] };
const stunde = 3600000;

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function event(name, felder) {
  const { data: ort } = await db.from("orte").select("id").limit(1).single();
  const { data, error } = await db
    .from("events")
    .insert({
      slug: `test-presale-${name}-${K}`,
      titel: `TEST PRESALE ${name.toUpperCase()}`,
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 20 * 24 * stunde).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
      ...felder,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event ${name}: ${error.message}`);
  angelegt.events.push(data.id);
  const { data: phase, error: pf } = await db
    .from("phasen")
    .insert({ event_id: data.id, name: "Early", art: "standard", preis_cent: 1000, gebuehr_cent: 100,
              kontingent: 50, verkauft: 0, position: 1, aktiv: true, leistungen: [] })
    .select("id")
    .single();
  if (pf) throw new Error(`Phase ${name}: ${pf.message}`);
  return { id: data.id, phase: phase.id };
}

async function code(felder) {
  const { data, error } = await db
    .from("rabattcodes")
    .insert({ code: `TPS${K.toUpperCase()}${felder.name}`, art: "prozent", ...felder, name: undefined })
    .select("id, code")
    .single();
  if (error) throw new Error(`Code ${felder.name}: ${error.message}`);
  angelegt.codes.push(data.id);
  return data;
}

async function reserviere(ev, email, extra = {}) {
  const { data, error } = await db.rpc("reserviere", {
    p_event_id: ev.id,
    p_auswahl: [{ phase_id: ev.phase, menge: 1 }],
    p_email: email,
    ...extra,
  });
  if (error) return { fehler: error.message };
  const { data: b } = await db
    .from("bestellungen").select("id, einladung_id, code_rabatt_cent, gesamt_cent").eq("id", data).single();
  return b;
}

async function bezahle(id) {
  const { error } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: id, p_zahlungsart: "frei", p_referenz: "presaletest",
  });
  if (error) throw new Error(`Zahlung: ${error.message}`);
}

async function durchspielen() {
  const frueher = await event("frueher", {});
  const presale = await event("jetzt", {
    presale_ab: new Date(Date.now() - stunde).toISOString(),
    verkauf_ab: new Date(Date.now() + 24 * stunde).toISOString(),
  });

  console.log("\n— Regeln der Tabelle —");
  const { error: nullOhne } = await db.from("rabattcodes")
    .insert({ code: `TPS${K.toUpperCase()}NULL`, art: "prozent", wert: 0 });
  pruefe(Boolean(nullOhne), "0 € Rabatt ohne Presale wird abgelehnt");
  const { error: presaleOhneVerkauf } = await db.from("events")
    .update({ presale_ab: new Date().toISOString(), verkauf_ab: null }).eq("id", frueher.id);
  pruefe(Boolean(presaleOhneVerkauf), "Presale ohne Verkaufsstart wird abgelehnt");

  console.log("\n— Frühere Gäste —");
  // Bezahlt mit Werbehinweis → darf eingeladen werden.
  const g1 = await reserviere(frueher, MAILS[0]);
  await db.from("bestellungen").update({ werbehinweis: true }).eq("id", g1.id);
  await bezahle(g1.id);
  // Bezahlt, aber vor dem Hinweis → nie.
  const g2 = await reserviere(frueher, MAILS[1]);
  await bezahle(g2.id);
  // Bezahlt mit Hinweis, aber abgemeldet → nie.
  const g3 = await reserviere(frueher, MAILS[2]);
  await db.from("bestellungen").update({ werbehinweis: true }).eq("id", g3.id);
  await bezahle(g3.id);
  await db.from("kunden").update({ keine_werbung: true }).eq("email", MAILS[2]);

  const { data: stand0 } = await db.rpc("presale_einladung_stand", { p_event_id: presale.id });
  const { data: vorbereitet } = await db.rpc("bereite_presale_einladungen_vor", {
    p_event_id: presale.id, p_grenze: 1000,
  });
  const eigene = (vorbereitet ?? []).filter((e) => MAILS.includes(e.email));
  pruefe(eigene.length === 1 && eigene[0].email === MAILS[0],
    "Nur der Gast mit Werbehinweis und ohne Abmeldung wird eingeladen",
    eigene.map((e) => e.email.split("-")[1]).join(","));
  pruefe(stand0 && stand0.moeglich >= 1, "Stand zählt mögliche Einladungen", JSON.stringify(stand0));
  const token = eigene[0]?.token;

  const { data: nochmal } = await db.rpc("bereite_presale_einladungen_vor", {
    p_event_id: presale.id, p_grenze: 1000,
  });
  pruefe((nochmal ?? []).filter((e) => e.email === MAILS[0]).length === 1,
    "Zweites Vorbereiten legt keine zweite Einladung an");

  console.log("\n— Presale-Zugang —");
  const ohne = await reserviere(presale, MAILS[3]);
  pruefe(ohne.fehler?.includes("PRESALE_ZUGANG_FEHLT"), "Ohne Zugang: abgelehnt", ohne.fehler ?? "");

  const normal = await code({ name: "RABATT", wert: 10 });
  const mitNormal = await reserviere(presale, MAILS[3], { p_code: normal.code });
  pruefe(mitNormal.fehler?.includes("PRESALE_ZUGANG_FEHLT"), "Normaler Rabattcode öffnet den Presale nicht");

  const offen = await code({ name: "OFFEN", wert: 0, oeffnet_presale: true, max_tickets: 2 });
  const mitCode = await reserviere(presale, MAILS[3], { p_code: offen.code.toLowerCase() });
  pruefe(!mitCode.fehler && mitCode.code_rabatt_cent === 0 && mitCode.gesamt_cent === 1100,
    "Presale-Code mit 0 € öffnet, ohne Rabatt", mitCode.fehler ?? `${mitCode.gesamt_cent}`);
  await reserviere(presale, MAILS[3], { p_code: offen.code });
  const voll = await reserviere(presale, MAILS[3], { p_code: offen.code });
  pruefe(voll.fehler?.includes("CODE_AUFGEBRAUCHT"), "Obergrenze des Presale-Codes greift", voll.fehler ?? "");

  const { data: zAufgebraucht } = await db.rpc("pruefe_presale_zugang", {
    p_event_id: presale.id, p_code: offen.code,
  });
  pruefe(zAufgebraucht?.zugang === null && zAufgebraucht?.grund === "aufgebraucht",
    "Vorschau meldet den aufgebrauchten Presale-Code", JSON.stringify(zAufgebraucht));

  const mitEinladung = await reserviere(presale, MAILS[0], { p_einladung: token });
  pruefe(!mitEinladung.fehler && mitEinladung.einladung_id === eigene[0]?.id,
    "Einladung öffnet für die eingeladene Adresse", mitEinladung.fehler ?? "");
  const weitergeleitet = await reserviere(presale, MAILS[4], { p_einladung: token });
  pruefe(weitergeleitet.fehler?.includes("PRESALE_ANDERE_ADRESSE"),
    "Weitergeleitete Einladung mit anderer Adresse: abgelehnt", weitergeleitet.fehler ?? "");

  const { data: zEinl } = await db.rpc("pruefe_presale_zugang", {
    p_event_id: presale.id, p_einladung: token,
  });
  pruefe(zEinl?.verkauf === "presale" && zEinl?.zugang === "einladung" && zEinl?.email === MAILS[0],
    "Vorschau erkennt die Einladung samt Adresse");
  const { data: zNichts } = await db.rpc("pruefe_presale_zugang", { p_event_id: presale.id });
  pruefe(zNichts?.verkauf === "presale" && zNichts?.zugang === null, "Vorschau ohne Zugang");

  await bezahle(mitEinladung.id);
  const { data: stand1 } = await db.rpc("presale_einladung_stand", { p_event_id: presale.id });
  pruefe(stand1?.gekauft === 1, "Kauf über Einladung wird gezählt", JSON.stringify(stand1));

  console.log("\n— Verkaufsstart —");
  await db.from("events").update({
    presale_ab: new Date(Date.now() + stunde).toISOString(),
    verkauf_ab: new Date(Date.now() + 2 * stunde).toISOString(),
  }).eq("id", presale.id);
  const vorher = await reserviere(presale, MAILS[3], { p_einladung: token });
  pruefe(vorher.fehler?.includes("VERKAUF_NOCH_NICHT"), "Vor dem Presale kauft niemand, auch nicht eingeladen");
  const { data: zBald } = await db.rpc("pruefe_presale_zugang", { p_event_id: presale.id });
  pruefe(zBald?.verkauf === "bald", "Vorschau: bald");

  await db.from("events").update({ presale_ab: null, verkauf_ab: new Date(Date.now() - stunde).toISOString() })
    .eq("id", presale.id);
  const danach = await reserviere(presale, MAILS[3]);
  pruefe(!danach.fehler, "Nach dem Verkaufsstart kauft jeder", danach.fehler ?? "");

  console.log("\n— Abmelden und Rechte —");
  const { data: ab } = await db.rpc("melde_werbung_ab", { p_token: token });
  const { data: kunde } = await db.from("kunden").select("keine_werbung").eq("email", MAILS[0]).single();
  pruefe(ab === true && kunde?.keine_werbung === true, "Abmeldelink setzt keine_werbung");

  const { error: anon1 } = await oeffentlich.rpc("pruefe_presale_zugang", { p_event_id: presale.id });
  const { error: anon2 } = await oeffentlich.rpc("melde_werbung_ab", { p_token: token });
  const { error: anon3 } = await oeffentlich.rpc("bereite_presale_einladungen_vor", { p_event_id: presale.id });
  pruefe(Boolean(anon1 && anon2 && anon3), "Öffentlicher Schlüssel kann keine Presale-Funktion aufrufen");
  const { data: anonLesen } = await oeffentlich.from("presale_einladungen").select("token");
  pruefe((anonLesen ?? []).length === 0, "Öffentlicher Schlüssel sieht keine Einladungen");
}

async function aufraeumen() {
  if (angelegt.events.length > 0) {
    const { data: bestellungen } = await db.from("bestellungen").select("id").in("event_id", angelegt.events);
    const ids = (bestellungen ?? []).map((b) => b.id);
    if (ids.length > 0) {
      await db.from("tickets").delete().in("bestellung_id", ids);
      await db.from("bestellpositionen").delete().in("bestellung_id", ids);
      await db.from("bestellungen").delete().in("id", ids);
    }
    await db.from("presale_einladungen").delete().in("event_id", angelegt.events);
  }
  if (angelegt.codes.length > 0) await db.from("rabattcodes").delete().in("id", angelegt.codes);
  await db.from("rabattcodes").delete().like("code", `TPS${K.toUpperCase()}%`);
  if (angelegt.events.length > 0) {
    await db.from("phasen").delete().in("event_id", angelegt.events);
    await db.from("events").delete().in("id", angelegt.events);
  }
  await db.from("kunden").delete().in("email", MAILS);

  const zaehle = async (tabelle, spalte, muster) =>
    (await db.from(tabelle).select("id", { count: "exact", head: true }).like(spalte, muster)).count;
  const rest = [
    await zaehle("events", "slug", `test-presale-%-${K}`),
    await zaehle("rabattcodes", "code", `TPS${K.toUpperCase()}%`),
    await zaehle("kunden", "email", `presaletest-%-${K}@lunar-events.de`),
  ];
  const sauber = rest.every((n) => n === 0);
  console.log(`\nAufgeräumt: ${sauber ? "Events, Codes, Einladungen und Testkunden weg" : `NOCH DA: ${rest.join("/")}`}`);
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
