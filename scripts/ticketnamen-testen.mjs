/**
 * Prüft Namen je Ticket (Migration 0046) an der echten Datenbank.
 *
 *   node scripts/ticketnamen-testen.mjs
 *
 * Auf einem eigenen Test-Event: Namen aus der Kasse landen in der richtigen
 * Reihenfolge auf den Tickets, alte Bestellungen bekommen den Käufer aufs
 * erste Ticket, Ändern über den Ticketlink (doppelt, halber Name, falscher
 * Link, nach Beginn, entwertet), Namen für den Scanner ohne Netz und das
 * Entwerten mit Name bzw. "Name fehlt" — mit einer echten Einlass-Sitzung.
 * Räumt im finally auf, auch Konto, Mitarbeiter- und Kundenzeilen. Das
 * echte Event bleibt unberührt.
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
const KAEUFER_A = `namentest-a-${K}@example.invalid`;
const KAEUFER_B = `namentest-b-${K}@example.invalid`;
const PERSONAL = `namentest-einlass-${K}@example.invalid`;
const SLUG = `test-namen-${K}`;

let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!ok) fehler++;
};

/** Wie einlass_pruefsumme() in der Datenbank und pruefsumme() im Scanner. */
const pruefsumme = (code) =>
  createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex").slice(0, 16);

async function sitzungFuer(email) {
  const { data, error } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const frisch = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sitzung, error: f } = await frisch.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: "email",
  });
  if (f) throw f;
  return { client: frisch, user: sitzung.user };
}

async function kaufe(eventId, phaseId, email, vorname, menge, namen) {
  const { data: id, error } = await dienst.rpc("reserviere", {
    p_event_id: eventId,
    p_auswahl: [{ phase_id: phaseId, menge }],
    p_email: email,
    p_vorname: vorname,
    p_nachname: "Käufer",
  });
  if (error) throw new Error(`reserviere: ${error.message}`);
  // So wie reserviereBestellung die Namen ablegt.
  if (namen) await dienst.from("bestellungen").update({ ticket_namen: namen }).eq("id", id);
  const { error: zf } = await dienst.rpc("bestaetige_zahlung", {
    p_bestellung_id: id,
    p_zahlungsart: "frei",
    p_referenz: "namentest",
  });
  if (zf) throw new Error(`bestaetige_zahlung: ${zf.message}`);
  const { data: b } = await dienst.from("bestellungen").select("zugangstoken").eq("id", id).single();
  const { data: tickets } = await dienst
    .from("tickets")
    .select("code, gast_name")
    .eq("bestellung_id", id)
    .order("erstellt_am")
    .order("id");
  return { id, token: b.zugangstoken, tickets };
}

const aendere = (token, code, name) =>
  dienst.rpc("aendere_ticketname", { p_token: token, p_code: code, p_name: name }).then((r) => r.data);

async function aufraeumen() {
  for (const email of [KAEUFER_A, KAEUFER_B, PERSONAL]) {
    const { data: kunde } = await dienst.from("kunden").select("id").eq("email", email).maybeSingle();
    if (!kunde) continue;
    const { data: best } = await dienst.from("bestellungen").select("id").eq("kunde_id", kunde.id);
    const ids = (best ?? []).map((b) => b.id);
    if (ids.length) {
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    await dienst.from("kunden").delete().eq("id", kunde.id);
  }
  const { data: ev } = await dienst.from("events").select("id").eq("slug", SLUG).maybeSingle();
  if (ev) {
    await dienst.from("phasen").delete().eq("event_id", ev.id);
    await dienst.from("events").delete().eq("id", ev.id);
  }
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const konto = konten.users.find((u) => u.email === PERSONAL);
  if (konto) {
    await dienst.from("mitarbeiter").delete().eq("user_id", konto.id);
    await dienst.auth.admin.deleteUser(konto.id);
  }
}

async function durchspielen() {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: event, error: evF } = await dienst
    .from("events")
    .insert({
      slug: SLUG,
      titel: "TEST NAMEN",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 30 * 86400000).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (evF) throw new Error(`Event: ${evF.message}`);
  const { data: phase, error: phF } = await dienst
    .from("phasen")
    .insert({
      event_id: event.id, name: "Online", art: "standard", preis_cent: 2000, gebuehr_cent: 0,
      kontingent: 20, verkauft: 0, aktiv: true, leistungen: [], position: 0,
    })
    .select("id")
    .single();
  if (phF) throw new Error(`Phase: ${phF.message}`);

  // --- Kaufen ---
  const a = await kaufe(event.id, phase.id, KAEUFER_A, "Anna", 3, ["Anna Eins", "Ben Zwei", "Cem Drei"]);
  pruefe(
    a.tickets.map((t) => t.gast_name).join("|") === "Anna Eins|Ben Zwei|Cem Drei",
    "Namen aus der Kasse in Reihenfolge auf den Tickets",
    a.tickets.map((t) => t.gast_name).join(", "),
  );
  const b = await kaufe(event.id, phase.id, KAEUFER_B, "Kara", 2, null);
  pruefe(
    b.tickets[0].gast_name === "Kara Käufer" && b.tickets[1].gast_name === null,
    "Ohne Namen: Käufer aufs erste Ticket, das zweite bleibt leer",
    b.tickets.map((t) => t.gast_name ?? "–").join(", "),
  );
  // Gekauft ist; aus den öffentlichen Listen nehmen. Ändern und Scannen gehen trotzdem.
  await dienst.from("events").update({ status: "entwurf" }).eq("id", event.id);

  // --- Ändern über den Ticketlink ---
  pruefe((await aendere(a.token, a.tickets[1].code, "  Dana   Vier ")) === "ok", "Name ändern");
  const { data: geaendert } = await dienst
    .from("tickets").select("gast_name").eq("code", a.tickets[1].code).single();
  pruefe(geaendert.gast_name === "Dana Vier", "Name bereinigt gespeichert", geaendert.gast_name);
  pruefe((await aendere(a.token, a.tickets[2].code, "anna eins")) === "doppelt", "Doppelter Name abgewiesen");
  pruefe((await aendere(a.token, a.tickets[2].code, "Cem")) === "name", "Halber Name abgewiesen");
  pruefe((await aendere(b.token, a.tickets[2].code, "Eva Fünf")) === "unbekannt", "Fremder Link ändert nichts");

  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { error: anonF } = await anon.rpc("aendere_ticketname", {
    p_token: a.token, p_code: a.tickets[2].code, p_name: "Eva Fünf",
  });
  pruefe(Boolean(anonF), "Ohne Dienstschlüssel nicht aufrufbar", anonF?.code ?? "aufrufbar!");

  // --- Scanner: ohne Rolle nichts ---
  const gast = await sitzungFuer(PERSONAL);
  const { data: namenGast } = await gast.client.rpc("einlass_namen", { p_event_id: event.id });
  pruefe(namenGast && Object.keys(namenGast).length === 0, "Ohne Rolle keine Namen", JSON.stringify(namenGast));

  // --- Scanner: mit Einlassrolle ---
  await dienst.from("mitarbeiter").upsert(
    { user_id: gast.user.id, name: "Namen Test", rolle: "einlass", aktiv: true },
    { onConflict: "user_id" },
  );
  const personal = await sitzungFuer(PERSONAL);

  const { data: namen } = await personal.client.rpc("einlass_namen", { p_event_id: event.id });
  pruefe(Object.keys(namen ?? {}).length === 4, "Namen für offline: alle gültigen mit Namen", `${Object.keys(namen ?? {}).length}`);
  pruefe(namen?.[pruefsumme(a.tickets[1].code)] === "Dana Vier", "Prüfsumme führt zum aktuellen Namen");

  const { data: scan1 } = await personal.client.rpc("entwerte_ticket", { p_code: a.tickets[1].code });
  pruefe(scan1.ergebnis === "gueltig" && scan1.gast === "Dana Vier" && scan1.name_fehlt === false,
    "Scan zeigt den Namen", `${scan1.ergebnis} · ${scan1.gast} · fehlt=${scan1.name_fehlt}`);
  const { data: scan2 } = await personal.client.rpc("entwerte_ticket", { p_code: a.tickets[1].code });
  pruefe(scan2.ergebnis === "schon_entwertet" && scan2.gast === "Dana Vier",
    "Auch \"schon drin\" nennt den Namen", `${scan2.ergebnis} · ${scan2.gast}`);
  const { data: scan3 } = await personal.client.rpc("entwerte_ticket", { p_code: b.tickets[1].code });
  pruefe(scan3.ergebnis === "gueltig" && !scan3.gast && scan3.name_fehlt === true,
    "Ticket ohne Namen: Scanner meldet es", `${scan3.ergebnis} · fehlt=${scan3.name_fehlt}`);

  pruefe((await aendere(a.token, a.tickets[1].code, "Eva Fünf")) === "nicht_gueltig",
    "Entwertetes Ticket lässt sich nicht umschreiben");

  const { data: namenDanach } = await personal.client.rpc("einlass_namen", { p_event_id: event.id });
  pruefe(Object.keys(namenDanach ?? {}).length === 3, "Entwertete fallen aus der Offline-Liste", `${Object.keys(namenDanach ?? {}).length}`);

  // --- Nach Beginn ---
  await dienst.from("events").update({ beginn: new Date(Date.now() - 60000).toISOString() }).eq("id", event.id);
  pruefe((await aendere(a.token, a.tickets[2].code, "Eva Fünf")) === "zu_spaet", "Nach Beginn nicht mehr änderbar");
}

try {
  await durchspielen();
} catch (f) {
  console.error("\nAbgebrochen:", f.message ?? f);
  fehler++;
} finally {
  await aufraeumen().catch((f) => console.error("Aufräumen:", f.message));
  console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles grün. Aufgeräumt.");
  process.exit(fehler ? 1 : 0);
}
