/**
 * Prüft die Garderobe (0027) mit echten Anmeldungen.
 *
 *   node scripts/garderobe-testen.mjs
 *
 * Legt ein Test-Event mit Garderobe (3 Plätze) an, kauft Tickets mit Marken,
 * lässt eine Reservierung verfallen, bestellt per Vorkasse, bucht auf der
 * Ticketseite nach und spielt den Tresen durch: Abgabe mit Bügelnummer,
 * doppelter Bügel, "gerade abgegeben", Abholung per Scan, Rückgängig und die
 * Liste für den Betrieb ohne Netz. Dazu die Rechte (Garderobe, Bar, Runner,
 * ohne Anmeldung). Räumt am Ende alles weg.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OEFFENTLICH =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const K = Date.now().toString(36);
const angelegt = { events: [], nutzer: [] };

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

/** Wie der Tresen im Browser: SHA-256, hex, die ersten 16 Zeichen. */
const pruefsumme = (code) =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex").slice(0, 16);

async function personal(rolle) {
  const email = `garderobetest-${rolle}-${K}@lunar-events.de`;
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${rolle}: ${error.message}`);
  angelegt.nutzer.push(neu.user.id);
  await dienst
    .from("mitarbeiter")
    .insert({ user_id: neu.user.id, name: `Garderobetest ${rolle}`, rolle, aktiv: true });
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: vf } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (vf) throw new Error(`Anmeldung ${rolle}: ${vf.message}`);
  return client;
}

async function event(slug, felder = {}) {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data, error } = await dienst
    .from("events")
    .insert({
      slug: `${slug}-${K}`,
      titel: "TEST GARDEROBE",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 30 * 86400000).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
      ...felder,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.events.push(data.id);
  return data.id;
}

const gast = (n) => `garderobetest-gast${n}-${K}@example.invalid`;

async function durchspielen() {
  console.log("— Angebot am Event —");
  const { error: zuBillig } = await dienst.from("orte").select("id").limit(1).single().then(async ({ data: ort }) =>
    dienst.from("events").insert({
      slug: `test-garderobe-billig-${K}`,
      titel: "TEST",
      kategorie: "club",
      beginn: new Date(Date.now() + 86400000).toISOString(),
      ort_id: ort.id,
      garderobe_aktiv: true,
      garderobe_preis_cent: 20,
    }),
  );
  pruefe(zuBillig?.message.includes("events_garderobe_gueltig"),
    "Garderobe unter 50 Cent wird abgelehnt", zuBillig?.message ?? "durchgelassen");

  const ev = await event("test-garderobe", {
    garderobe_aktiv: true,
    garderobe_preis_cent: 300,
    garderobe_kontingent: 3,
  });
  const anderesEv = await event("test-garderobe-anderes");
  const { data: ph, error: phFehler } = await dienst
    .from("phasen")
    .insert({
      event_id: ev,
      name: "Online",
      art: "standard",
      preis_cent: 2000,
      gebuehr_cent: 200,
      kontingent: 20,
      verkauft: 0,
      aktiv: true,
      leistungen: [],
      position: 0,
    })
    .select("id")
    .single();
  if (phFehler) throw new Error(`Phase: ${phFehler.message}`);
  const reserviere = (menge, garderobe, email) =>
    dienst.rpc("reserviere", {
      p_event_id: ev,
      p_auswahl: [{ phase_id: ph.id, menge }],
      p_email: email,
      p_vorname: "Garda",
      p_nachname: `Test${K}`,
      p_garderobe: garderobe,
    });
  const verkauft = async () =>
    (await dienst.from("events").select("garderobe_verkauft").eq("id", ev).single()).data
      .garderobe_verkauft;

  console.log("\n— In der Kasse —");
  const { error: zuViel } = await reserviere(2, 5, gast(1));
  pruefe(zuViel?.message.includes("GARDEROBE_MENGE"), "Höchstens zwei je Ticket", zuViel?.message ?? "durchgelassen");

  const { data: b1, error: b1Fehler } = await reserviere(2, 2, gast(1));
  if (b1Fehler) throw new Error(`Reservierung: ${b1Fehler.message}`);
  const { data: z1 } = await dienst
    .from("bestellungen")
    .select("summe_cent, gebuehr_cent, gesamt_cent, garderobe_menge, garderobe_preis_cent, zugangstoken")
    .eq("id", b1)
    .single();
  pruefe(z1.summe_cent === 4600 && z1.gebuehr_cent === 400 && z1.gesamt_cent === 5000,
    "2 Tickets + 2 Garderobe: 46 € + 4 € Gebühr = 50 €", JSON.stringify(z1));
  pruefe(z1.garderobe_menge === 2 && z1.garderobe_preis_cent === 300, "Menge und Preis in die Bestellung kopiert");
  pruefe((await verkauft()) === 2, "Kontingent zählt 2");

  const { error: voll } = await reserviere(1, 2, gast(2));
  pruefe(voll?.message.includes("GARDEROBE_AUSVERKAUFT:1"), "Nur noch 1 Platz frei — Bestellung abgelehnt",
    voll?.message ?? "durchgelassen");
  const { data: phStand } = await dienst.from("phasen").select("verkauft").eq("id", ph.id).single();
  pruefe(phStand.verkauft === 2, "…und die Tickets dieser Bestellung sind nicht hängen geblieben",
    String(phStand.verkauft));

  console.log("\n— Verfall —");
  const { data: b2 } = await reserviere(1, 1, gast(2));
  pruefe((await verkauft()) === 3, "Reservierung hält den letzten Platz");
  await dienst.from("bestellungen").update({ reserviert_bis: new Date(Date.now() - 60000).toISOString() }).eq("id", b2);
  await dienst.rpc("raeume_reservierungen_auf");
  pruefe((await verkauft()) === 2, "Nach dem Verfall ist er wieder frei");

  console.log("\n— Vorkasse —");
  const { data: b3 } = await reserviere(1, 1, gast(3));
  await dienst.rpc("waehle_vorkasse", { p_bestellung_id: b3 });
  const { data: z3 } = await dienst.from("bestellungen").select("gesamt_cent, rabatt_cent").eq("id", b3).single();
  pruefe(z3.gesamt_cent === 2300 && z3.rabatt_cent === 200,
    "Vorkasse erlässt nur die Gebühr, die Garderobe bleibt im Betrag", JSON.stringify(z3));

  console.log("\n— Bezahlt —");
  const { error: bezFehler } = await dienst.rpc("bestaetige_zahlung", {
    p_bestellung_id: b1, p_zahlungsart: "frei", p_referenz: "testkauf",
  });
  if (bezFehler) throw new Error(`Bezahlen: ${bezFehler.message}`);
  const { data: marken1 } = await dienst.from("garderobe_marken").select("id, code, status").eq("bestellung_id", b1);
  pruefe(marken1.length === 2 && marken1.every((m) => /^G-[A-Z2-9]{20}$/.test(m.code) && m.status === "gueltig"),
    "Zwei Marken mit eigenem Code (G-…)", marken1.map((m) => m.code).join(", "));
  await dienst.rpc("bestaetige_zahlung", { p_bestellung_id: b1, p_zahlungsart: "frei", p_referenz: "testkauf" });
  const { count: nochmal } = await dienst.from("garderobe_marken")
    .select("id", { count: "exact", head: true }).eq("bestellung_id", b1);
  pruefe(nochmal === 2, "Zweimal bestätigt, trotzdem nur zwei Marken");
  const { data: tickets1 } = await dienst.from("tickets").select("code").eq("bestellung_id", b1);

  console.log("\n— Nachbuchen —");
  const { error: nbVoll } = await dienst.rpc("reserviere_garderobe", { p_token: z1.zugangstoken, p_anzahl: 1 });
  pruefe(nbVoll?.message.includes("GARDEROBE_AUSVERKAUFT"), "Garderobe voll — Nachbuchen abgelehnt",
    nbVoll?.message ?? "durchgelassen");
  await dienst.from("events").update({ garderobe_kontingent: 10 }).eq("id", ev);
  const { error: nbMenge } = await dienst.rpc("reserviere_garderobe", { p_token: z1.zugangstoken, p_anzahl: 3 });
  pruefe(nbMenge?.message.includes("GARDEROBE_MENGE:2"), "Zwei Tickets, zwei schon gebucht: noch 2 möglich",
    nbMenge?.message ?? "durchgelassen");
  const { data: nb, error: nbFehler } = await dienst.rpc("reserviere_garderobe", {
    p_token: z1.zugangstoken, p_anzahl: 2,
  });
  if (nbFehler) throw new Error(`Nachbuchen: ${nbFehler.message}`);
  const { data: znb } = await dienst.from("bestellungen")
    .select("status, gesamt_cent, nachbuchung_zu, kunde_id, zugangstoken, bestellpositionen(id)")
    .eq("id", nb).single();
  const { data: zb1 } = await dienst.from("bestellungen").select("kunde_id").eq("id", b1).single();
  pruefe(znb.status === "offen" && znb.gesamt_cent === 600 && znb.nachbuchung_zu === b1 &&
    znb.kunde_id === zb1.kunde_id && znb.bestellpositionen.length === 0,
    "Eigene Bestellung: 6 €, gehört zur ersten, derselbe Kunde, keine Tickets");
  const { error: nbGrenze } = await dienst.rpc("reserviere_garderobe", { p_token: z1.zugangstoken, p_anzahl: 1 });
  pruefe(nbGrenze?.message.includes("GARDEROBE_MENGE:0"), "Laufende Nachbuchung zählt schon mit",
    nbGrenze?.message ?? "durchgelassen");
  const { error: nbEigen } = await dienst.rpc("reserviere_garderobe", { p_token: znb.zugangstoken, p_anzahl: 1 });
  pruefe(nbEigen?.message.includes("BESTELLUNG_UNBEKANNT"), "Auf eine Nachbuchung lässt sich nicht nachbuchen");
  const { data: z3t } = await dienst.from("bestellungen").select("zugangstoken").eq("id", b3).single();
  const { error: nbOffen } = await dienst.rpc("reserviere_garderobe", { p_token: z3t.zugangstoken, p_anzahl: 1 });
  pruefe(nbOffen?.message.includes("BESTELLUNG_UNBEKANNT"), "Unbezahlte Bestellung: kein Nachbuchen");
  await dienst.rpc("bestaetige_zahlung", { p_bestellung_id: nb, p_zahlungsart: "frei", p_referenz: "testkauf" });
  const { data: marken2 } = await dienst.from("garderobe_marken").select("id, code").eq("bestellung_id", nb);
  pruefe(marken2.length === 2, "Nach der Zahlung zwei weitere Marken");

  const [m1, m2] = marken1;
  const [m3] = marken2;

  console.log("\n— Rechte am Tresen —");
  const garderobe = await personal("garderobe");
  const bar = await personal("bar");
  const runner = await personal("runner");
  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });

  const { data: rScan } = await runner.rpc("garderobe_scan", { p_code: m1.code, p_event_id: ev });
  pruefe(rScan?.ergebnis === "keine_berechtigung", "Runner scannt keine Marken", rScan?.ergebnis);
  const { data: rListe } = await runner.rpc("garderobe_liste", { p_event_id: ev });
  pruefe(Array.isArray(rListe) && rListe.length === 0, "Runner bekommt eine leere Liste");
  const { error: aScan } = await anon.rpc("garderobe_scan", { p_code: m1.code, p_event_id: ev });
  pruefe(Boolean(aScan), "Ohne Anmeldung geht nichts");
  const { data: gTicket } = await garderobe.rpc("entwerte_ticket", { p_code: tickets1[0].code });
  pruefe(gTicket?.ergebnis === "keine_berechtigung", "Garderobe entwertet keine Tickets", gTicket?.ergebnis);
  const { error: nbRecht } = await garderobe.rpc("reserviere_garderobe", { p_token: z1.zugangstoken, p_anzahl: 1 });
  pruefe(Boolean(nbRecht), "Nachbuchen nur über den Server (Dienstschlüssel)");

  console.log("\n— Abgabe —");
  const scanne = (client, code, eventId = ev) => client.rpc("garderobe_scan", { p_code: code, p_event_id: eventId });
  pruefe((await scanne(garderobe, tickets1[0].code)).data?.ergebnis === "ticket", "Ein Ticket wird als Ticket erkannt");
  pruefe((await scanne(garderobe, "G-UNBEKANNT")).data?.ergebnis === "unbekannt", "Unbekannter Code");
  pruefe((await scanne(garderobe, m1.code, anderesEv)).data?.ergebnis === "anderes_event", "Marke eines anderen Events");

  const s1 = (await scanne(garderobe, m1.code.toLowerCase())).data;
  pruefe(s1?.ergebnis === "abgabe" && s1.id === m1.id && s1.name === `Garda Test${K}`,
    "Erster Scan: Abgabe, mit Namen (Kleinschreibung egal)", JSON.stringify(s1));
  const { data: a1 } = await garderobe.rpc("garderobe_abgeben", { p_id: m1.id, p_nummer: " 147 " });
  pruefe(a1?.ergebnis === "ok" && a1.nummer === "147", "An Bügel 147 gehängt", JSON.stringify(a1));
  const { data: a2 } = await bar.rpc("garderobe_abgeben", { p_id: m2.id, p_nummer: "147" });
  pruefe(a2?.ergebnis === "nummer_belegt", "Bügel 147 ist belegt — auch für ein anderes Gerät", a2?.ergebnis);
  const { data: a3 } = await bar.rpc("garderobe_abgeben", { p_id: m2.id, p_nummer: "148" });
  pruefe(a3?.ergebnis === "ok", "Bar hilft aus: Bügel 148", a3?.ergebnis);
  const { data: a4 } = await garderobe.rpc("garderobe_abgeben", { p_id: m1.id, p_nummer: "149" });
  pruefe(a4?.ergebnis === "schon_abgegeben" && a4.nummer === "147", "Zweimal abgeben geht nicht", JSON.stringify(a4));

  console.log("\n— Abholung —");
  const s2 = (await scanne(garderobe, m1.code)).data;
  pruefe(s2?.ergebnis === "gerade_abgegeben" && s2.nummer === "147",
    "Gleich nochmal gescannt: nicht ausgegeben, nur angezeigt", s2?.ergebnis);
  const { data: aus1 } = await garderobe.rpc("garderobe_ausgeben", { p_id: m1.id });
  pruefe(aus1?.ergebnis === "abholung" && aus1.nummer === "147", "„Trotzdem ausgeben“ gibt Bügel 147 aus");
  const s3 = (await scanne(garderobe, m1.code)).data;
  pruefe(s3?.ergebnis === "schon_abgeholt" && s3.nummer === "147" && Boolean(s3.zeitpunkt),
    "Danach: schon abgeholt, mit Uhrzeit", s3?.ergebnis);

  // Die Drei-Minuten-Regel überspringen, als wäre es später am Abend.
  await dienst.from("garderobe_marken")
    .update({ abgegeben_am: new Date(Date.now() - 10 * 60000).toISOString() }).eq("id", m2.id);
  const s4 = (await scanne(garderobe, m2.code)).data;
  pruefe(s4?.ergebnis === "abholung" && s4.nummer === "148", "Später gescannt: Abholung in einem Schritt, Bügel 148",
    JSON.stringify(s4));

  console.log("\n— Rückgängig —");
  const { data: a5 } = await garderobe.rpc("garderobe_abgeben", { p_id: m3.id, p_nummer: "147" });
  pruefe(a5?.ergebnis === "ok", "Bügel 147 ist wieder frei und neu vergeben");
  const { data: r1 } = await garderobe.rpc("garderobe_rueckgaengig", { p_id: m1.id });
  pruefe(r1?.ergebnis === "nummer_belegt", "Abholung von 147 lässt sich nicht zurücknehmen — der Bügel ist neu belegt",
    r1?.ergebnis);
  const { data: r2 } = await garderobe.rpc("garderobe_rueckgaengig", { p_id: m3.id });
  pruefe(r2?.ergebnis === "ok" && r2.zustand === "offen", "Abgabe zurückgenommen", JSON.stringify(r2));
  const { data: r3 } = await garderobe.rpc("garderobe_rueckgaengig", { p_id: m1.id });
  pruefe(r3?.ergebnis === "ok" && r3.zustand === "haengt" && r3.nummer === "147",
    "Jetzt geht es: Marke 1 hängt wieder an 147", JSON.stringify(r3));

  console.log("\n— Liste für den Betrieb ohne Netz —");
  const { data: liste } = await garderobe.rpc("garderobe_liste", { p_event_id: ev });
  const zu = (id) => liste.find((m) => m.id === id);
  pruefe(liste.length === 4, "Vier Marken", String(liste?.length));
  pruefe(liste.every((m) => !("code" in m)) && zu(m1.id)?.summe === pruefsumme(m1.code),
    "Nur Prüfsummen, keine Codes — und dieselbe Prüfsumme wie auf dem Gerät");
  pruefe(zu(m1.id)?.zustand === "haengt" && zu(m2.id)?.zustand === "abgeholt" && zu(m3.id)?.zustand === "offen",
    "Zustände stimmen", liste.map((m) => m.zustand).join(", "));

  const { data: geschrieben } = await garderobe.from("garderobe_marken")
    .update({ nummer: "999" }).eq("id", m3.id).select("id");
  const { data: m3jetzt } = await dienst.from("garderobe_marken").select("nummer").eq("id", m3.id).single();
  pruefe((geschrieben ?? []).length === 0 && m3jetzt.nummer === null,
    "Direkt in die Tabelle schreiben geht nicht — nur über die Funktionen");
}

async function aufraeumen() {
  for (const ev of angelegt.events) {
    const { data: bestellungen } = await dienst.from("bestellungen").select("id, kunde_id").eq("event_id", ev);
    const ids = (bestellungen ?? []).map((b) => b.id);
    const kunden = [...new Set((bestellungen ?? []).map((b) => b.kunde_id))];
    if (ids.length) {
      await dienst.from("garderobe_marken").delete().in("bestellung_id", ids);
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").update({ nachbuchung_zu: null }).in("id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    if (kunden.length) await dienst.from("kunden").delete().in("id", kunden);
    await dienst.from("ereignisse").delete().eq("event_id", ev);
    await dienst.from("phasen").delete().eq("event_id", ev);
    await dienst.from("events").delete().eq("id", ev);
  }
  for (const id of angelegt.nutzer) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  // Zu jedem Konto legt 0004 eine Kundenzeile an — die muss mit weg.
  await dienst.from("kunden").delete().like("email", `garderobetest-%-${K}@lunar-events.de`);
  const { count } = await dienst.from("events")
    .select("id", { count: "exact", head: true }).like("slug", `%-${K}`);
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("garderobetest-")).length;
  const sauber = count === 0 && rest === 0;
  console.log(`\nAufgeräumt: ${sauber ? "Events, Bestellungen, Marken, Kunden und Testkonten weg" : `NOCH DA: ${count}/${rest}`}`);
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
