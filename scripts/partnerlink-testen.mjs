/**
 * Prüft den Partnerlink je Event (Migration 0047) an der echten Datenbank.
 *
 *   node scripts/partnerlink-testen.mjs                       # nur Zugriffsregeln
 *   node scripts/partnerlink-testen.mjs http://localhost:3007 # dazu die Seite selbst
 *   node scripts/partnerlink-testen.mjs <adresse> --behalten  # Test-Event stehen lassen
 *   node scripts/partnerlink-testen.mjs --weg                 # stehengelassenes wegräumen
 *
 * Eigenes Test-Event mit fünf Bestellungen: zwei bezahlt (eine mit einem
 * stornierten Ticket), eine offen, eine an der Abendkasse, eine ganz
 * storniert. Gast und Kunde kommen nicht an die Tabelle, ein Admin legt den
 * Link an und erneuert ihn. Mit Adresse wird die Seite abgerufen: Namen und
 * Summen müssen drinstehen, Mailadressen, Offenes und Abendkasse nicht, und
 * der alte Link liefert nach dem Erneuern 404. Das echte Event bleibt unberührt.
 */
import { createClient } from "@supabase/supabase-js";
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

const SLUG = "test-partnerlink";
const ADMIN = "partnertest-admin@example.invalid";
const KUNDE = "partnertest-kunde@example.invalid";
const KAEUFER = (n) => `partnertest-kaeufer${n}@example.invalid`;
const SEITE = process.argv.find((a) => a.startsWith("http"));

let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!ok) fehler++;
};

async function sitzung(email, rolle) {
  let { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  let konto = konten.users.find((u) => u.email === email);
  if (!konto) {
    const { data, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    konto = data.user;
  }
  if (rolle) {
    await dienst.from("mitarbeiter").upsert({ user_id: konto.id, name: "Partnertest", rolle, aktiv: true });
  }
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (error) throw error;
  return client;
}

async function aufraeumen() {
  const { data: ev } = await dienst.from("events").select("id").eq("slug", SLUG).maybeSingle();
  if (ev) {
    const { data: b } = await dienst.from("bestellungen").select("id").eq("event_id", ev.id);
    const ids = (b ?? []).map((x) => x.id);
    if (ids.length) {
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    await dienst.from("partner_links").delete().eq("event_id", ev.id);
    await dienst.from("phasen").delete().eq("event_id", ev.id);
    await dienst.from("events").delete().eq("id", ev.id);
  }
  await dienst.from("kunden").delete().like("email", "partnertest-%@example.invalid");
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  for (const konto of konten.users.filter((u) => [ADMIN, KUNDE].includes(u.email))) {
    await dienst.from("mitarbeiter").delete().eq("user_id", konto.id);
    await dienst.auth.admin.deleteUser(konto.id);
  }
  await dienst.from("kunden").delete().like("email", "partnertest-%@example.invalid");
}

async function durchspielen() {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error: evF } = await dienst.from("events").insert({
    slug: SLUG, titel: "TEST PARTNER", kategorie: "club", status: "veroeffentlicht",
    beginn: new Date(Date.now() + 30 * 86400000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (evF) throw new Error(`Event: ${evF.message}`);
  const { data: ph } = await dienst.from("phasen").insert({
    event_id: ev.id, name: "Online", art: "standard", preis_cent: 2000, gebuehr_cent: 0,
    kontingent: 50, verkauft: 0, aktiv: true, leistungen: [], position: 0,
  }).select("id").single();

  const kauf = async (n, vorname, nachname, menge, bezahlen = true) => {
    const { data: id, error } = await dienst.rpc("reserviere", {
      p_event_id: ev.id, p_auswahl: [{ phase_id: ph.id, menge }],
      p_email: KAEUFER(n), p_vorname: vorname, p_nachname: nachname,
    });
    if (error) throw new Error(`reserviere ${n}: ${error.message}`);
    if (bezahlen) {
      await dienst.rpc("bestaetige_zahlung", { p_bestellung_id: id, p_zahlungsart: "frei", p_referenz: "partnertest" });
    }
    return id;
  };
  const b1 = await kauf(1, "Anna", "Alpha", 2);
  await dienst.from("tickets").update({ fastlane: true }).eq("bestellung_id", b1);
  const b2 = await kauf(2, "Ben", "Beta", 3);
  await kauf(3, "Cem", "Offen", 1, false);
  const b4 = await kauf(4, "Dora", "Tuer", 1);
  const b5 = await kauf(5, "Emil", "Erstattet", 1);
  await dienst.from("events").update({ status: "entwurf" }).eq("id", ev.id);

  // Ein Ticket von Ben storniert, Dora als Abendkasse, Emil ganz storniert.
  const { data: benTickets } = await dienst.from("tickets").select("id").eq("bestellung_id", b2).limit(1);
  await dienst.from("tickets").update({ status: "storniert" }).eq("id", benTickets[0].id);
  await dienst.from("bestellungen").update({ abendkasse: true }).eq("id", b4);
  await dienst.from("tickets").update({ status: "storniert" }).eq("bestellung_id", b5);

  // --- Zugriffsregeln ---
  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { data: anonDaten } = await anon.from("partner_links").select("token");
  pruefe((anonDaten ?? []).length === 0, "Gast liest keine Partnerlinks");
  const { error: anonSchreib } = await anon.from("partner_links").insert({ event_id: ev.id });
  pruefe(Boolean(anonSchreib), "Gast legt keinen an", anonSchreib?.code ?? "angelegt!");

  const kunde = await sitzung(KUNDE, null);
  const { error: kundeSchreib } = await kunde.from("partner_links").insert({ event_id: ev.id });
  pruefe(Boolean(kundeSchreib), "Angemeldeter Kunde legt keinen an", kundeSchreib?.code ?? "angelegt!");

  const admin = await sitzung(ADMIN, "admin");
  const { data: erster, error: aF } = await admin
    .from("partner_links").upsert({ event_id: ev.id, token: "a".repeat(64) }, { onConflict: "event_id" })
    .select("token").single();
  pruefe(!aF && erster?.token === "a".repeat(64), "Admin legt den Link an", aF?.message ?? "");
  const { data: kundeLiest } = await kunde.from("partner_links").select("token");
  pruefe((kundeLiest ?? []).length === 0, "Kunde liest ihn nicht");
  const { data: evSpalten } = await anon.from("events").select("*").limit(1);
  pruefe(!Object.keys(evSpalten?.[0] ?? {}).some((k) => k.includes("token")), "Kein Schlüssel in der öffentlichen Event-Tabelle");

  // --- Seite ---
  if (SEITE) {
    const alt = await fetch(`${SEITE}/partner/${"a".repeat(64)}`);
    const html = await alt.text();
    pruefe(alt.status === 200, "Seite lädt", String(alt.status));
    pruefe(html.includes("Anna Alpha") && html.includes("Ben Beta"), "Bezahlte Käufer stehen drin");
    pruefe(!html.includes("Cem") && !html.includes("Dora") && !html.includes("Emil"),
      "Offen, Abendkasse und Storniertes fehlen");
    pruefe(!html.includes("@example.invalid"), "Keine Mailadressen");
    // Nur im sichtbaren Teil zählen: Next schickt den Inhalt zusätzlich in
    // <script>-Blöcken mit.
    const sichtbar = html.replace(/<script[\s\S]*?<\/script>/g, "");
    const zeileAnna = sichtbar.match(/Anna Alpha[\s\S]*?<\/li>/)?.[0] ?? "";
    const zeileBen = sichtbar.match(/Ben Beta[\s\S]*?<\/li>/)?.[0] ?? "";
    pruefe(zeileAnna.includes("Online") && zeileAnna.includes("Mit Fast Lane")
      && zeileBen.includes("Online") && !zeileBen.includes("Fast Lane"),
      "Ticketart je Bestellung, Fast Lane nur bei Anna");
    // Summe 4 (2 + 2), 2 Bestellungen
    pruefe(/>4<\/span>/.test(html) && />2<\/span>/.test(html), "Summen 4 Tickets, 2 Bestellungen");

    const { error: rF } = await admin
      .from("partner_links").upsert({ event_id: ev.id, token: "b".repeat(64) }, { onConflict: "event_id" });
    pruefe(!rF, "Admin erneuert den Link");
    const nachher = await fetch(`${SEITE}/partner/${"a".repeat(64)}`);
    pruefe(nachher.status === 404, "Alter Link liefert 404", String(nachher.status));
    const neu = await fetch(`${SEITE}/partner/${"b".repeat(64)}`);
    pruefe(neu.status === 200, "Neuer Link lädt", String(neu.status));
    const kaputt = await fetch(`${SEITE}/partner/kurz`);
    pruefe(kaputt.status === 404, "Kurzer Schlüssel liefert 404", String(kaputt.status));
    if (process.argv.includes("--behalten")) {
      console.log(`\nStehen gelassen: ${SEITE}/partner/${"b".repeat(64)}  (weg mit --weg)`);
    }
  }
}

if (process.argv.includes("--weg")) {
  await aufraeumen();
  console.log("Aufgeräumt.");
  process.exit(0);
}
try {
  await aufraeumen();
  await durchspielen();
} catch (f) {
  console.error("\nAbgebrochen:", f.message ?? f);
  fehler++;
} finally {
  if (!process.argv.includes("--behalten") || fehler) await aufraeumen().catch((f) => console.error(f.message));
  console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles grün.");
  process.exit(fehler ? 1 : 0);
}
