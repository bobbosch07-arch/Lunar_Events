/**
 * Prüft die Promoter-Staffel (Migration 0040).
 *
 *   node scripts/staffel-testen.mjs
 *
 * Code ohne Rabatt, Weg je Bestellung (Link, Code, beides), keine
 * Doppelzählung, Storno, Stichtag und dass die Rangliste nur Admins
 * antwortet. Eigenes Test-Event als Entwurf (nur kurz veröffentlicht, damit
 * reserviere() es annimmt), räumt im finally alles wieder weg, auch die
 * Kundenzeilen. Das echte Event wird nicht angefasst.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const K = Date.now().toString(36);
let fehler = 0;
const pruefe = (ok, text, zusatz = "") => { console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`); if (!ok) fehler++; };
const angelegt = { event: null, promoter: [], code: null };

async function aufraeumen() {
  if (angelegt.event) {
    const { data: b } = await db.from("bestellungen").select("id, kunde_id").eq("event_id", angelegt.event);
    const ids = (b ?? []).map(x => x.id), kunden = (b ?? []).map(x => x.kunde_id).filter(Boolean);
    if (ids.length) {
      await db.from("tickets").delete().in("bestellung_id", ids);
      await db.from("bestellpositionen").delete().in("bestellung_id", ids);
      await db.from("bestellungen").delete().in("id", ids);
    }
    if (kunden.length) await db.from("kunden").delete().in("id", kunden);
    await db.from("ereignisse").delete().eq("event_id", angelegt.event);
    await db.from("phasen").delete().eq("event_id", angelegt.event);
    await db.from("events").delete().eq("id", angelegt.event);
  }
  if (angelegt.code) await db.from("rabattcodes").delete().eq("id", angelegt.code);
  for (const p of angelegt.promoter) await db.from("promoter").delete().eq("id", p);
  await db.from("kunden").delete().like("email", `staffeltest-%-${K}@example.invalid`);
}

try {
  const { data: ort } = await db.from("orte").select("id").limit(1).single();
  const { data: ev, error: evF } = await db.from("events").insert({
    slug: `staffeltest-${K}`, titel: "TEST STAFFEL", kategorie: "club", status: "entwurf",
    beginn: new Date(Date.now() + 30 * 86400000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (evF) throw evF;
  angelegt.event = ev.id;
  const { data: ph } = await db.from("phasen").insert({
    event_id: ev.id, name: "Online", art: "standard", preis_cent: 1000, gebuehr_cent: 100,
    kontingent: 50, verkauft: 0, aktiv: true, leistungen: [], position: 0,
  }).select("id").single();
  await db.from("promoter_stufen").insert([
    { event_id: ev.id, ab_tickets: 5, belohnung: "1 Gratis-Ticket" },
    { event_id: ev.id, ab_tickets: 10, belohnung: "Fast Lane + 1 Shot" },
  ]);

  const { data: a } = await db.from("promoter").insert({ name: "Test A", kuerzel: `sta-${K}` }).select("id, token, kuerzel").single();
  const { data: b } = await db.from("promoter").insert({ name: "Test B", kuerzel: `stb-${K}` }).select("id, token, kuerzel").single();
  angelegt.promoter.push(a.id, b.id);

  console.log("— Code ohne Rabatt —");
  const code = `STA${K}`.toUpperCase().slice(0, 20);
  const { data: c, error: cF } = await db.from("rabattcodes").insert({ code, art: "betrag", wert: 0, promoter_id: a.id }).select("id").single();
  pruefe(!cF, "Code mit 0 € für einen Promoter wird angenommen", cF?.message ?? "");
  angelegt.code = c?.id;
  const { error: ohneP } = await db.from("rabattcodes").insert({ code: `X${code}`.slice(0, 20), art: "betrag", wert: 0 });
  pruefe(Boolean(ohneP), "…ohne Promoter weiter abgelehnt", ohneP?.message?.slice(0, 50) ?? "durchgelassen");

  await db.from("events").update({ status: "veroeffentlicht" }).eq("id", ev.id);
  const vorschau = await db.rpc("pruefe_rabattcode", { p_code: code, p_event_id: ev.id, p_auswahl: [{ phase_id: ph.id, menge: 2 }] });
  pruefe(vorschau.data?.ergebnis === "ok" && vorschau.data?.rabatt_cent === 0 && vorschau.data?.wert === 0,
    "Kasse erkennt ihn: ok, 0 € Rabatt", JSON.stringify(vorschau.data));

  const kauf = async (n, { kuerzel = null, mitCode = false }) => {
    const { data: bid, error } = await db.rpc("reserviere", {
      p_event_id: ev.id, p_auswahl: [{ phase_id: ph.id, menge: 2 }],
      p_email: `staffeltest-${n}-${K}@example.invalid`, p_vorname: "Staffel", p_nachname: `Test${n}`,
      p_code: mitCode ? code : null,
    });
    if (error) throw new Error(`Reservierung ${n}: ${error.message}`);
    await db.rpc("ordne_promoter_zu", { p_bestellung_id: bid, p_kuerzel: kuerzel });
    await db.rpc("bestaetige_zahlung", { p_bestellung_id: bid, p_zahlungsart: "frei", p_referenz: "testkauf" });
    const { data: z } = await db.from("bestellungen").select("promoter_id, promoter_weg, code_rabatt_cent, gesamt_cent").eq("id", bid).single();
    return z;
  };

  console.log("\n— Vier Wege —");
  const z1 = await kauf(1, { kuerzel: a.kuerzel });
  pruefe(z1.promoter_id === a.id && z1.promoter_weg === "link", "Nur Link von A → A, link", JSON.stringify(z1));
  const z2 = await kauf(2, { mitCode: true });
  pruefe(z2.promoter_id === a.id && z2.promoter_weg === "code" && z2.code_rabatt_cent === 0, "Nur Code von A → A, code, kein Rabatt", JSON.stringify(z2));
  const z3 = await kauf(3, { kuerzel: a.kuerzel, mitCode: true });
  pruefe(z3.promoter_id === a.id && z3.promoter_weg === "beides", "Link und Code von A → A, beides", JSON.stringify(z3));
  const z4 = await kauf(4, { kuerzel: b.kuerzel, mitCode: true });
  pruefe(z4.promoter_id === a.id && z4.promoter_weg === "code", "Link von B, Code von A → A, code", JSON.stringify(z4));
  await db.from("events").update({ status: "entwurf" }).eq("id", ev.id);

  console.log("\n— Zählung —");
  const { data: sa } = await db.rpc("promoter_statistik", { p_token: a.token });
  const ea = sa.events.find(e => e.id === ev.id);
  pruefe(ea?.tickets === 8, "A: 4 Bestellungen à 2 = 8 Tickets, nichts doppelt", String(ea?.tickets));
  pruefe(ea?.weg?.link === 2 && ea?.weg?.code === 4 && ea?.weg?.beides === 2, "A: Link 2, Code 4, Beides 2", JSON.stringify(ea?.weg));
  pruefe(ea?.tickets_staffel === 8 && ea?.stufen?.length === 2, "A: Staffel zählt 8, zwei Stufen", JSON.stringify({ s: ea?.tickets_staffel, n: ea?.stufen?.length }));
  const { data: sb } = await db.rpc("promoter_statistik", { p_token: b.token });
  const eb = sb.events.find(e => e.id === ev.id);
  pruefe(!eb || eb.tickets === 0, "B: kein Ticket (sein Link verlor gegen den Code)", JSON.stringify(eb ?? null));

  console.log("\n— Storno und Stichtag —");
  const { data: einTicket } = await db.from("tickets").select("id, bestellung_id").in("bestellung_id",
    (await db.from("bestellungen").select("id").eq("event_id", ev.id).eq("promoter_weg", "link")).data.map(x => x.id)).limit(1).single();
  await db.from("tickets").update({ status: "storniert" }).eq("id", einTicket.id);
  const { data: sa2 } = await db.rpc("promoter_statistik", { p_token: a.token });
  pruefe(sa2.events.find(e => e.id === ev.id)?.tickets === 7, "Ein storniertes Ticket zählt nicht mehr", String(sa2.events.find(e => e.id === ev.id)?.tickets));
  await db.from("events").update({ promo_stichtag: new Date(Date.now() - 3600000).toISOString() }).eq("id", ev.id);
  const { data: sa3 } = await db.rpc("promoter_statistik", { p_token: a.token });
  const ea3 = sa3.events.find(e => e.id === ev.id);
  pruefe(ea3?.tickets_staffel === 0 && ea3?.tickets === 7, "Stichtag vorbei: Staffel 0, Verkäufe weiter 7", JSON.stringify({ s: ea3?.tickets_staffel, t: ea3?.tickets }));

  const { error: rang } = await db.rpc("promoter_rangliste", { p_event_id: ev.id });
  pruefe(Boolean(rang?.message?.includes("NUR_ADMIN")), "Rangliste ohne Admin-Anmeldung abgewiesen", rang?.message ?? "durchgelassen");
} catch (e) {
  console.error("Abbruch:", e.message ?? e);
  fehler++;
} finally {
  await aufraeumen();
  console.log(`\n${fehler === 0 ? "Alles grün." : `${fehler} Fehler.`} Aufgeräumt.`);
}
