/**
 * Prüft die Abendkasse mit echten Anmeldungen.
 *
 *   node scripts/kasse-testen.mjs
 *
 * Legt ein Test-Event mit einer Online-Phase und einer Abendkassen-Phase an,
 * dazu Konten für Kasse und Bar. Verkauft bar und per QR, lässt ein und
 * prüft Kassenstand, Kontingent und Rechte. Die QR-Zahlung wird wie vom
 * Webhook bestätigt (bestaetige_zahlung) — der Stripe-Teil selbst hat sein
 * eigenes Skript (zahlung-testen.mjs). Räumt am Ende alles weg.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { richteZweitenFaktorEin } from "./_totp.mjs";

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
const angelegt = { event: null, nutzer: [] };

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function personal(rolle) {
  const email = `kassetest-${rolle}-${K}@lunar-events.de`;
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${rolle}: ${error.message}`);
  angelegt.nutzer.push(neu.user.id);
  await dienst
    .from("mitarbeiter")
    .insert({ user_id: neu.user.id, name: `Kassetest ${rolle}`, rolle, aktiv: true });
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

async function durchspielen() {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst
    .from("events")
    .insert({
      slug: `test-kasse-${K}`,
      titel: "TEST ABENDKASSE",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 30 * 86400000).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.event = ev.id;

  const phase = async (felder) => {
    const { data, error: pf } = await dienst
      .from("phasen")
      .insert({
        event_id: ev.id,
        art: "standard",
        gebuehr_cent: 0,
        verkauft: 0,
        aktiv: true,
        leistungen: [],
        ...felder,
      })
      .select("id")
      .single();
    if (pf) throw new Error(`Phase: ${pf.message}`);
    return data.id;
  };
  // Die Türphase steht absichtlich vorn und hat Tickets — sie darf den
  // Online-Verkauf trotzdem nicht blockieren (Phasenfolge, 0010).
  const tuer = await phase({ name: "Abendkasse", preis_cent: 2500, kontingent: 5, position: 0, abendkasse: true });
  const online = await phase({ name: "Online", preis_cent: 2000, kontingent: 10, position: 1 });

  const kasse = await personal("kasse");
  await richteZweitenFaktorEin(kasse, "Kassetest");
  const bar = await personal("bar");

  console.log("\n— Online bleibt online —");
  const { error: tuerOnline } = await dienst.rpc("reserviere", {
    p_event_id: ev.id,
    p_auswahl: [{ phase_id: tuer, menge: 1 }],
    p_email: `kassetest-gast-${K}@example.invalid`,
  });
  pruefe(tuerOnline?.message.includes("PHASE_NUR_ABENDKASSE"),
    "Die Türphase ist online nicht kaufbar", tuerOnline?.message ?? "durchgelassen");
  const { data: onlineBestellung, error: onlineFehler } = await dienst.rpc("reserviere", {
    p_event_id: ev.id,
    p_auswahl: [{ phase_id: online, menge: 1 }],
    p_email: `kassetest-gast-${K}@example.invalid`,
  });
  pruefe(!onlineFehler && Boolean(onlineBestellung),
    "Online-Phase kaufbar, obwohl die Türphase vorn steht und Tickets hat", onlineFehler?.message ?? "");

  console.log("\n— Bar —");
  const { data: barDarf } = await bar.rpc("verkaufe_abendkasse", {
    p_event_id: ev.id, p_phase_id: tuer, p_menge: 1,
  });
  pruefe(barDarf?.ergebnis === "keine_berechtigung", "Bar darf nicht kassieren", barDarf?.ergebnis);

  const { data: v1, error: v1Fehler } = await kasse.rpc("verkaufe_abendkasse", {
    p_event_id: ev.id, p_phase_id: tuer, p_menge: 2, p_zahlung: "bar", p_einlassen: true,
  });
  if (v1Fehler) throw new Error(`Verkauf: ${v1Fehler.message}`);
  pruefe(v1?.ergebnis === "ok" && v1.bezahlt && v1.eingelassen && v1.codes.length === 2 && v1.gesamt_cent === 5000,
    "Kasse verkauft 2 bar, sofort eingelassen", JSON.stringify({ e: v1?.ergebnis, g: v1?.gesamt_cent }));
  const { data: t1 } = await dienst.from("tickets").select("status, entwertet_von").eq("bestellung_id", v1.bestellung_id);
  pruefe(t1.length === 2 && t1.every((t) => t.status === "entwertet" && t.entwertet_von),
    "Beide Tickets sind entwertet, mit Name der Kasse");
  const { data: b1 } = await dienst.from("bestellungen")
    .select("status, zahlungsart, abendkasse, kunde_id").eq("id", v1.bestellung_id).single();
  pruefe(b1.status === "bezahlt" && b1.zahlungsart === "abendkasse" && b1.abendkasse,
    "Bestellung: bezahlt, bar, als Abendkasse markiert");

  const { data: v2 } = await kasse.rpc("verkaufe_abendkasse", {
    p_event_id: ev.id, p_phase_id: tuer, p_menge: 1, p_zahlung: "bar", p_einlassen: false,
  });
  const { data: t2 } = await dienst.from("tickets").select("status").eq("bestellung_id", v2.bestellung_id);
  pruefe(t2.length === 1 && t2[0].status === "gueltig", "„Nur verkaufen“: Ticket bleibt gültig für später");
  const { data: b2 } = await dienst.from("bestellungen").select("kunde_id").eq("id", v2.bestellung_id).single();
  pruefe(b2.kunde_id === b1.kunde_id, "Ohne Adresse: ein gemeinsamer Kunde „Abendkasse“ je Event");

  const { data: zuViel } = await kasse.rpc("verkaufe_abendkasse", {
    p_event_id: ev.id, p_phase_id: tuer, p_menge: 3,
  });
  pruefe(zuViel?.ergebnis === "ausverkauft" && zuViel.rest === 2, "Kontingent hält: nur noch 2", JSON.stringify(zuViel));

  console.log("\n— QR am Gasthandy —");
  const { data: v3 } = await kasse.rpc("verkaufe_abendkasse", {
    p_event_id: ev.id, p_phase_id: tuer, p_menge: 1, p_zahlung: "qr", p_einlassen: true,
  });
  const { data: b3 } = await dienst.from("bestellungen")
    .select("status, reserviert_bis").eq("id", v3.bestellung_id).single();
  const { count: t3vorher } = await dienst.from("tickets")
    .select("id", { count: "exact", head: true }).eq("bestellung_id", v3.bestellung_id);
  pruefe(v3?.ergebnis === "ok" && !v3.bezahlt && b3.status === "offen" && t3vorher === 0,
    "QR: Bestellung offen, noch keine Tickets");
  const frist = (new Date(b3.reserviert_bis) - Date.now()) / 60000;
  pruefe(frist > 18 && frist <= 20.1, "QR: 20 Minuten Zeit zum Zahlen", `${frist.toFixed(1)} min`);

  const { data: zuFrueh } = await kasse.rpc("abendkasse_einlassen", { p_bestellung_id: v3.bestellung_id });
  pruefe(zuFrueh?.ergebnis === "nicht_bezahlt", "Einlassen vor der Zahlung geht nicht");

  // So wie der Stripe-Webhook nach der Zahlung
  await dienst.rpc("bestaetige_zahlung", {
    p_bestellung_id: v3.bestellung_id, p_zahlungsart: "stripe", p_referenz: "kassetest",
  });
  const { data: rein } = await kasse.rpc("abendkasse_einlassen", { p_bestellung_id: v3.bestellung_id });
  const { data: nochmal } = await kasse.rpc("abendkasse_einlassen", { p_bestellung_id: v3.bestellung_id });
  pruefe(rein?.eingelassen === 1 && nochmal?.eingelassen === 0,
    "Nach der Zahlung: eingelassen, ein zweites Mal ändert nichts");

  console.log("\n— Kassenstand —");
  const { data: stand } = await kasse.rpc("abendkasse_stand", { p_event_id: ev.id });
  pruefe(stand?.tickets === 4 && stand.bar_cent === 7500 && stand.qr_cent === 2500,
    "4 Tickets, 75 € bar, 25 € per QR", JSON.stringify(stand));
  const { data: barStand } = await bar.rpc("abendkasse_stand", { p_event_id: ev.id });
  pruefe(barStand?.ergebnis === "keine_berechtigung", "Bar sieht den Kassenstand nicht");

  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { error: anonFehler } = await anon.rpc("verkaufe_abendkasse", {
    p_event_id: ev.id, p_phase_id: tuer, p_menge: 1,
  });
  pruefe(Boolean(anonFehler), "Ohne Anmeldung verkauft niemand");

  const { data: tuerPhase } = await dienst.from("phasen").select("verkauft").eq("id", tuer).single();
  pruefe(tuerPhase.verkauft === 4, "Die Türphase zählt 4 verkaufte", String(tuerPhase.verkauft));
}

async function aufraeumen() {
  if (angelegt.event) {
    const { data: bestellungen } = await dienst.from("bestellungen").select("id, kunde_id").eq("event_id", angelegt.event);
    const ids = (bestellungen ?? []).map((b) => b.id);
    const kunden = [...new Set((bestellungen ?? []).map((b) => b.kunde_id))];
    if (ids.length) {
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    if (kunden.length) await dienst.from("kunden").delete().in("id", kunden);
    await dienst.from("ereignisse").delete().eq("event_id", angelegt.event);
    await dienst.from("phasen").delete().eq("event_id", angelegt.event);
    await dienst.from("events").delete().eq("id", angelegt.event);
  }
  for (const id of angelegt.nutzer) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  const { count } = await dienst.from("events")
    .select("id", { count: "exact", head: true }).eq("slug", `test-kasse-${K}`);
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("kassetest-")).length;
  const sauber = count === 0 && rest === 0;
  console.log(`\nAufgeräumt: ${sauber ? "Event, Bestellungen, Kunden und Testkonten weg" : `NOCH DA: ${count}/${rest}`}`);
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
