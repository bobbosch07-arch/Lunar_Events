/**
 * Prüft die Kontingent-Schritte aus Migration 0044.
 *
 *   node scripts/kontingente-testen.mjs
 *
 * Mit einer echten Admin-Sitzung (Wegwerf-Konto) auf einem eigenen
 * Test-Event: Kontingent setzen (nie unter „verkauft“), Tickets
 * verschieben, Phase schließen mit Verteilung, wieder öffnen, Belegung je
 * Phase, und dass ein Gast nichts davon darf. Danach ist die zweite Phase
 * kaufbar, obwohl die erste noch freie Plätze hatte. Räumt im finally auf,
 * auch Konto, Mitarbeiter- und Kundenzeilen. Das echte Event bleibt unberührt.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OEFFENTLICH = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const K = Date.now().toString(36);
const ADMIN = `kontingenttest-admin-${K}@example.invalid`;
let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!ok) fehler++;
};
const angelegt = { event: null, konto: null };

async function aufraeumen() {
  if (angelegt.event) {
    const { data: b } = await dienst.from("bestellungen").select("id, kunde_id").eq("event_id", angelegt.event);
    const ids = (b ?? []).map((x) => x.id);
    const kunden = (b ?? []).map((x) => x.kunde_id).filter(Boolean);
    if (ids.length) {
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    if (kunden.length) await dienst.from("kunden").delete().in("id", kunden);
    await dienst.from("phasen").delete().eq("event_id", angelegt.event);
    await dienst.from("events").delete().eq("id", angelegt.event);
  }
  if (angelegt.konto) {
    await dienst.from("mitarbeiter").delete().eq("user_id", angelegt.konto);
    await dienst.from("kunden").delete().eq("email", ADMIN);
    await dienst.auth.admin.deleteUser(angelegt.konto);
  }
  await dienst.from("kunden").delete().like("email", `kontingenttest-gast%-${K}@example.invalid`);
}

const phase = async (id) =>
  (await dienst.from("phasen").select("kontingent, verkauft, aktiv").eq("id", id).single()).data;

try {
  // --- Admin-Sitzung ---
  const { data: konto, error: kF } = await dienst.auth.admin.createUser({ email: ADMIN, email_confirm: true });
  if (kF) throw kF;
  angelegt.konto = konto.user.id;
  await dienst.from("mitarbeiter").upsert({ user_id: konto.user.id, name: "Kontingenttest", rolle: "admin", aktiv: true });
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email: ADMIN });
  const admin = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { error: anF } = await admin.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (anF) throw anF;

  // --- Test-Event mit drei Phasen ---
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev } = await dienst.from("events").insert({
    slug: `kontingenttest-${K}`, titel: "TEST KONTINGENTE", kategorie: "club", status: "entwurf",
    beginn: new Date(Date.now() + 30 * 86400000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  angelegt.event = ev.id;
  const neuePhase = async (name, kontingent, position) =>
    (await dienst.from("phasen").insert({
      event_id: ev.id, name, art: "standard", preis_cent: 1000 + position * 100, gebuehr_cent: 0,
      kontingent, verkauft: 0, aktiv: true, leistungen: [], position,
    }).select("id").single()).data.id;
  const eb = await neuePhase("Early Bird", 30, 1);
  const p2 = await neuePhase("Phase 2", 30, 2);
  const cl = await neuePhase("Classic", 200, 3);

  // 18 Early Birds: 15 bezahlt, 3 reserviert
  await dienst.from("events").update({ status: "veroeffentlicht" }).eq("id", ev.id);
  const reserviere = async (n, menge) => {
    const { data, error } = await dienst.rpc("reserviere", {
      p_event_id: ev.id, p_auswahl: [{ phase_id: eb, menge }],
      p_email: `kontingenttest-gast${n}-${K}@example.invalid`, p_vorname: "K", p_nachname: `Test${n}`,
    });
    if (error) throw new Error(`Reservierung ${n}: ${error.message}`);
    return data;
  };
  for (const [n, menge] of [[1, 5], [2, 5], [3, 5]]) {
    const bid = await reserviere(n, menge);
    await dienst.rpc("bestaetige_zahlung", { p_bestellung_id: bid, p_zahlungsart: "frei", p_referenz: "testkauf" });
  }
  await reserviere(4, 3);

  console.log("— Belegung —");
  const { data: bel, error: belF } = await admin.rpc("phasen_belegung", { p_event_id: ev.id });
  const ebBel = (bel ?? []).find((z) => z.phase_id === eb);
  pruefe(!belF && ebBel?.bezahlt === 15 && ebBel?.reserviert === 3, "Early Bird: 15 bezahlt, 3 reserviert", JSON.stringify(ebBel ?? belF?.message));

  console.log("\n— Zähler abgleichen (0045) —");
  // Wie nach einer gelöschten Bestellung: Zähler eins zu hoch.
  await dienst.from("phasen").update({ verkauft: 19 }).eq("id", eb);
  const { data: zs } = await admin.rpc("phasen_zaehlerstand", { p_event_id: ev.id });
  const ebZ = (zs ?? []).find((z) => z.phase_id === eb);
  pruefe(ebZ?.ist === 19 && ebZ?.soll === 18, "Zählerstand erkennt: Zähler 19, Soll 18", JSON.stringify(ebZ));
  // Ein storniertes Ticket (Erstattung) gibt seinen Platz frei.
  const { data: einT } = await dienst.from("tickets").select("id").eq("phase_id", eb).eq("status", "gueltig").limit(1).single();
  await dienst.from("tickets").update({ status: "storniert" }).eq("id", einT.id);
  const ab = await admin.rpc("phasen_abgleichen", { p_event_id: ev.id });
  pruefe(!ab.error && (await phase(eb)).verkauft === 17, "Abgleich: 19 → 17 (gelöschte Bestellung und storniertes Ticket)", JSON.stringify(ab.data ?? ab.error?.message));
  await dienst.from("tickets").update({ status: "gueltig" }).eq("id", einT.id);
  await admin.rpc("phasen_abgleichen", { p_event_id: ev.id });
  const gastAb = await createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } }).rpc("phasen_abgleichen", { p_event_id: ev.id });
  pruefe(Boolean(gastAb.error), "Gast darf nicht abgleichen", gastAb.error?.message?.slice(0, 40) ?? "durchgelassen");
  pruefe((await phase(eb)).verkauft === 18, "…und zurück auf 18 für die weiteren Prüfungen");

  console.log("\n— Kontingent setzen —");
  const unter = await admin.rpc("phase_kontingent_setzen", { p_phase: eb, p_kontingent: 10 });
  pruefe(unter.error?.message?.startsWith("UNTER_VERKAUFT:18"), "Nicht unter die 18 belegten", unter.error?.message ?? "durchgelassen");
  const setzen = await admin.rpc("phase_kontingent_setzen", { p_phase: p2, p_kontingent: 40 });
  pruefe(!setzen.error && (await phase(p2)).kontingent === 40, "Phase 2 auf 40", setzen.error?.message ?? "");

  console.log("\n— Verschieben —");
  const zuviel = await admin.rpc("phase_tickets_verschieben", { p_von: eb, p_nach: cl, p_menge: 13 });
  pruefe(zuviel.error?.message?.startsWith("ZU_VIEL:12"), "Höchstens die 12 freien", zuviel.error?.message ?? "durchgelassen");
  const schieb = await admin.rpc("phase_tickets_verschieben", { p_von: p2, p_nach: cl, p_menge: 10 });
  pruefe(!schieb.error && (await phase(p2)).kontingent === 30 && (await phase(cl)).kontingent === 210,
    "10 von Phase 2 nach Classic: 30 und 210", schieb.error?.message ?? "");

  console.log("\n— Phase schließen —");
  const schliessZuviel = await admin.rpc("phase_schliessen", {
    p_phase: eb, p_verteilung: [{ phase_id: p2, menge: 10 }, { phase_id: cl, menge: 3 }],
  });
  pruefe(schliessZuviel.error?.message?.startsWith("ZU_VIEL:12"), "Verteilung über die 12 freien abgewiesen", schliessZuviel.error?.message ?? "durchgelassen");
  pruefe((await phase(eb)).aktiv === true, "…und nichts geändert (alles oder nichts)");
  const zu = await admin.rpc("phase_schliessen", {
    p_phase: eb, p_verteilung: [{ phase_id: p2, menge: 6 }, { phase_id: cl, menge: 4 }],
  });
  const ebNach = await phase(eb);
  pruefe(!zu.error && ebNach.aktiv === false && ebNach.kontingent === 18,
    "Early Bird zu, Kontingent = 18 belegt, 2 fallen weg", JSON.stringify(zu.data ?? zu.error?.message));
  pruefe((await phase(p2)).kontingent === 36 && (await phase(cl)).kontingent === 214, "Phase 2 +6 = 36, Classic +4 = 214");

  // Phase 2 ist jetzt kaufbar, obwohl Early Bird nie ausverkauft war.
  const { error: p2Kauf } = await dienst.rpc("reserviere", {
    p_event_id: ev.id, p_auswahl: [{ phase_id: p2, menge: 1 }],
    p_email: `kontingenttest-gast5-${K}@example.invalid`, p_vorname: "K", p_nachname: "Test5",
  });
  pruefe(!p2Kauf, "Phase 2 lässt sich jetzt kaufen", p2Kauf?.message ?? "");
  const { error: ebKauf } = await dienst.rpc("reserviere", {
    p_event_id: ev.id, p_auswahl: [{ phase_id: eb, menge: 1 }],
    p_email: `kontingenttest-gast6-${K}@example.invalid`, p_vorname: "K", p_nachname: "Test6",
  });
  pruefe(Boolean(ebKauf), "Early Bird nimmt nichts mehr an", ebKauf?.message?.slice(0, 50) ?? "durchgelassen");

  // Die offene Reservierung verfällt: Early Bird bleibt zu, der Platz ist frei zum Verteilen.
  await dienst.from("bestellungen").update({ reserviert_bis: new Date(Date.now() - 60000).toISOString() })
    .eq("event_id", ev.id).eq("status", "offen").like("nummer", "%");
  await dienst.rpc("raeume_reservierungen_auf");
  const ebVerfall = await phase(eb);
  pruefe(ebVerfall.aktiv === false && ebVerfall.kontingent - ebVerfall.verkauft === 3,
    "Verfallene Reservierung: Early Bird bleibt zu, 3 wieder frei zum Verteilen", JSON.stringify(ebVerfall));
  const nach = await admin.rpc("phase_tickets_verschieben", { p_von: eb, p_nach: cl, p_menge: 3 });
  pruefe(!nach.error, "…und lassen sich nachträglich verschieben", nach.error?.message ?? "");

  console.log("\n— Wieder öffnen —");
  const auf = await admin.rpc("phase_oeffnen", { p_phase: eb });
  pruefe(!auf.error && (await phase(eb)).aktiv === true, "Early Bird wieder aktiv", auf.error?.message ?? "");

  console.log("\n— Rechte —");
  const gast = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const g1 = await gast.rpc("phase_kontingent_setzen", { p_phase: p2, p_kontingent: 999 });
  const g2 = await gast.rpc("phase_schliessen", { p_phase: p2, p_verteilung: [] });
  const g3 = await gast.rpc("phasen_belegung", { p_event_id: ev.id });
  pruefe(Boolean(g1.error) && Boolean(g2.error) && Boolean(g3.error), "Gast darf nichts davon",
    [g1, g2, g3].map((g) => g.error?.message?.slice(0, 30)).join(" | "));
} catch (e) {
  console.error("Abbruch:", e.message ?? e);
  fehler++;
} finally {
  await aufraeumen();
  console.log(`\n${fehler === 0 ? "Alles grün." : `${fehler} Fehler.`} Aufgeräumt.`);
}
