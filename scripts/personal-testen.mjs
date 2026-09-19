/**
 * Prüft, dass Personal keine fremden Tickets und Garderobenmarken mehr
 * lesen kann (0031), mit echten Anmeldungen.
 *
 *   node scripts/personal-testen.mjs
 *
 * Legt ein eigenes Test-Event mit Garderobe an, dazu zwei bezahlte
 * Bestellungen: eine von einer Kundin mit Konto, eine als Gastkauf. Dann
 * fragt jede Rolle direkt die Tabellen ab und holt die Prüfsummen für den
 * Scanner. Zum Schluss die Abfrage von „Meine Tickets“ für Admin und
 * Kundin. Räumt am Ende alles weg, auch die Kundenzeilen aus 0004.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
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
const angelegt = { events: [], nutzer: [] };

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

/** Wie der Scanner im Browser: SHA-256, hex, die ersten 16 Zeichen. */
const pruefsumme = (code) =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex").slice(0, 16);

async function konto(name) {
  const email = `personaltest-${name}-${K}@lunar-events.de`;
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${name}: ${error.message}`);
  angelegt.nutzer.push(neu.user.id);
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: vf } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (vf) throw new Error(`Anmeldung ${name}: ${vf.message}`);
  return { email, id: neu.user.id, client };
}

async function personal(rolle) {
  const k = await konto(rolle);
  const { error } = await dienst
    .from("mitarbeiter")
    .insert({ user_id: k.id, name: `Personaltest ${rolle}`, rolle, aktiv: true });
  if (error) throw new Error(`Mitarbeiter ${rolle}: ${error.message}`);
  if (rolle === "admin") await richteZweitenFaktorEin(k.client, "Personaltest");
  return k;
}

async function durchspielen() {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error: evFehler } = await dienst
    .from("events")
    .insert({
      slug: `test-personal-${K}`,
      titel: "TEST PERSONAL",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 30 * 86400000).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
      garderobe_aktiv: true,
      garderobe_preis_cent: 300,
      garderobe_kontingent: 10,
    })
    .select("id")
    .single();
  if (evFehler) throw new Error(`Event: ${evFehler.message}`);
  angelegt.events.push(ev.id);

  const { data: ph, error: phFehler } = await dienst
    .from("phasen")
    .insert({
      event_id: ev.id, name: "Online", art: "standard", preis_cent: 2000, gebuehr_cent: 200,
      kontingent: 20, verkauft: 0, aktiv: true, leistungen: [], position: 0,
    })
    .select("id")
    .single();
  if (phFehler) throw new Error(`Phase: ${phFehler.message}`);

  const kaufe = async (email) => {
    const { data: b, error } = await dienst.rpc("reserviere", {
      p_event_id: ev.id,
      p_auswahl: [{ phase_id: ph.id, menge: 1 }],
      p_email: email,
      p_vorname: "Pia",
      p_nachname: `Test${K}`,
      p_garderobe: 1,
    });
    if (error) throw new Error(`Reservierung: ${error.message}`);
    const { error: bz } = await dienst.rpc("bestaetige_zahlung", {
      p_bestellung_id: b, p_zahlungsart: "frei", p_referenz: "testkauf",
    });
    if (bz) throw new Error(`Bezahlen: ${bz.message}`);
    return b;
  };

  // Die Kundin hat ein Konto; 0004 legt dazu die Kundenzeile an, und die
  // Bestellung mit derselben Adresse landet dort.
  const kundin = await konto("kundin");
  const bKundin = await kaufe(kundin.email);
  const bGast = await kaufe(`personaltest-gast-${K}@example.invalid`);
  // Kaufen geht nur bei veröffentlichten Events; danach wieder aus den
  // öffentlichen Listen nehmen.
  await dienst.from("events").update({ status: "entwurf" }).eq("id", ev.id);

  const { data: alleTickets } = await dienst
    .from("tickets").select("code, bestellung_id").eq("event_id", ev.id);
  const codeKundin = alleTickets.find((t) => t.bestellung_id === bKundin).code;
  const codeGast = alleTickets.find((t) => t.bestellung_id === bGast).code;

  const rollen = {};
  for (const rolle of ["admin", "kasse", "einlass", "bar", "garderobe"]) {
    rollen[rolle] = await personal(rolle);
  }

  const tickets = async (client) =>
    (await client.from("tickets").select("code").eq("event_id", ev.id)).data ?? [];
  const marken = async (client) =>
    (await client.from("garderobe_marken").select("code").in("bestellung_id", [bKundin, bGast])).data ?? [];

  console.log("— Direkt lesen —");
  for (const rolle of ["kasse", "einlass", "bar", "garderobe"]) {
    const t = await tickets(rollen[rolle].client);
    const m = await marken(rollen[rolle].client);
    pruefe(t.length === 0 && m.length === 0, `${rolle}: keine Tickets, keine Marken`,
      `${t.length}/${m.length}`);
  }
  const adminT = await tickets(rollen.admin.client);
  const adminM = await marken(rollen.admin.client);
  pruefe(adminT.length === 2 && adminM.length === 2, "Admin liest weiter alles (Backoffice)",
    `${adminT.length}/${adminM.length}`);
  const kundinT = await tickets(kundin.client);
  const kundinM = await marken(kundin.client);
  pruefe(kundinT.length === 1 && kundinT[0].code === codeKundin && kundinM.length === 1,
    "Die Kundin liest nur ihr eigenes Ticket und ihre Marke", `${kundinT.length}/${kundinM.length}`);

  console.log("\n— Prüfsummen für den Scanner —");
  const erwartet = [pruefsumme(codeKundin), pruefsumme(codeGast)].sort().join(",");
  for (const rolle of ["admin", "kasse", "einlass", "bar"]) {
    const { data, error } = await rollen[rolle].client.rpc("einlass_pruefsummen", { p_event_id: ev.id });
    pruefe(!error && [...(data ?? [])].sort().join(",") === erwartet,
      `${rolle}: bekommt beide Prüfsummen, gleich wie auf dem Gerät`, error?.message ?? "");
  }
  const { data: gardSummen } = await rollen.garderobe.client.rpc("einlass_pruefsummen", { p_event_id: ev.id });
  pruefe((gardSummen ?? []).length === 0, "garderobe (scannt keine Tickets): leere Liste");
  const { data: kundinSummen } = await kundin.client.rpc("einlass_pruefsummen", { p_event_id: ev.id });
  pruefe((kundinSummen ?? []).length === 0, "Kundin: leere Liste");
  const niemand = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { error: anonFehler } = await niemand.rpc("einlass_pruefsummen", { p_event_id: ev.id });
  pruefe(Boolean(anonFehler), "Ohne Anmeldung nicht aufrufbar", anonFehler?.message ?? "durchgelassen");

  console.log("\n— Scannen geht weiter —");
  const { data: scan } = await rollen.bar.client.rpc("entwerte_ticket", { p_code: codeGast });
  pruefe(scan?.ergebnis === "gueltig", "Bar entwertet das Gast-Ticket", scan?.ergebnis);
  const { data: nachScan } = await rollen.bar.client.rpc("einlass_pruefsummen", { p_event_id: ev.id });
  pruefe((nachScan ?? []).length === 1 && nachScan[0] === pruefsumme(codeKundin),
    "Danach nur noch die Prüfsumme des gültigen Tickets");

  console.log("\n— Meine Tickets —");
  // Dieselbe Abfrage wie holeMeineTickets() in src/lib/konto.ts
  const meine = async (k) => {
    const { data: kunden } = await k.client.from("kunden").select("id").eq("user_id", k.id);
    const ids = (kunden ?? []).map((z) => z.id);
    if (ids.length === 0) return [];
    const { data, error } = await k.client
      .from("tickets")
      .select("code, bestellung:bestellungen!inner(nummer, status, kunde_id)")
      .eq("bestellung.status", "bezahlt")
      .in("bestellung.kunde_id", ids);
    if (error) throw new Error(`Meine Tickets: ${error.message}`);
    return data ?? [];
  };
  const adminMeine = (await meine(rollen.admin)).filter((t) => [codeKundin, codeGast].includes(t.code));
  pruefe(adminMeine.length === 0, "Admin sieht unter „Meine Tickets“ keine fremden", String(adminMeine.length));
  const kundinMeine = await meine(kundin);
  pruefe(kundinMeine.length === 1 && kundinMeine[0].code === codeKundin, "Kundin sieht ihr Ticket",
    String(kundinMeine.length));
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
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    if (kunden.length) await dienst.from("kunden").delete().in("id", kunden);
    await dienst.from("phasen").delete().eq("event_id", ev);
    await dienst.from("events").delete().eq("id", ev);
  }
  for (const id of angelegt.nutzer) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  // Zu jedem Konto legt 0004 eine Kundenzeile an — die muss mit weg.
  await dienst.from("kunden").delete().like("email", `personaltest-%-${K}@%`);
  const { count } = await dienst.from("events")
    .select("id", { count: "exact", head: true }).like("slug", `%-${K}`);
  const { count: kundenRest } = await dienst.from("kunden")
    .select("id", { count: "exact", head: true }).like("email", `personaltest-%-${K}@%`);
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("personaltest-")).length;
  const sauber = count === 0 && rest === 0 && kundenRest === 0;
  console.log(`\nAufgeräumt: ${sauber ? "Event, Bestellungen, Kunden und Testkonten weg" : `NOCH DA: ${count}/${rest}/${kundenRest}`}`);
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
