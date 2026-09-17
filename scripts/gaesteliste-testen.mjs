/**
 * Prüft die Gästeliste mit echten Anmeldungen.
 *
 *   node scripts/gaesteliste-testen.mjs
 *
 * Legt ein Test-Event als Entwurf an und drei Testkonten (Admin, Bar,
 * Einlass), weil die Funktionen auf auth.uid() und die Rolle schauen — mit
 * dem Dienstschlüssel wäre die Prüfung wertlos. Spielt Anlegen, Ändern,
 * QR-Scan, Namensliste und Entfernen durch und räumt am Ende alles weg, auch
 * wenn unterwegs etwas schiefgeht.
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
const konto = (rolle) => `gaestetest-${rolle}-${K}@lunar-events.de`;
const angelegt = { event: null, nutzer: [] };

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

/** Legt ein Konto mit Rolle an und meldet es an, ohne Mail. */
async function personal(rolle) {
  const email = konto(rolle);
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${rolle}: ${error.message}`);
  angelegt.nutzer.push(neu.user.id);
  const { error: mf } = await dienst.from("mitarbeiter")
    .insert({ user_id: neu.user.id, name: `Gästetest ${rolle}`, rolle, aktiv: true });
  if (mf) throw new Error(`Mitarbeiter ${rolle}: ${mf.message}`);

  const { data: link, error: lf } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (lf) throw new Error(`Link ${rolle}: ${lf.message}`);
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: vf } = await client.auth.verifyOtp({ email, token: link.properties.email_otp, type: "email" });
  if (vf) throw new Error(`Anmeldung ${rolle}: ${vf.message}`);
  return client;
}

async function tickets(gastId) {
  const { data } = await dienst.from("tickets")
    .select("code, status, gast_name, phase_name, bestellung_id, phase_id")
    .eq("gast_id", gastId).order("erstellt_am").order("id");
  return data ?? [];
}

async function durchspielen() {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst.from("events").insert({
    slug: `test-gaeste-${K}`, titel: "TEST GÄSTELISTE", kategorie: "club", status: "entwurf",
    beginn: new Date(Date.now() + 10 * 86400000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.event = ev.id;

  const admin = await personal("admin");
  // Zweiter Faktor, falls die Pflicht scharf steht (Migration 0022).
  await richteZweitenFaktorEin(admin, "Gästetest");
  const bar = await personal("bar");
  const einlass = await personal("einlass");

  console.log("\n— Anlegen und Rechte —");
  const { data: ohne } = await bar.rpc("speichere_gast", {
    p_id: null, p_event_id: ev.id, p_name: "Max", p_email: null, p_begleitung: 0, p_notiz: null,
  });
  pruefe(ohne?.ergebnis === "keine_berechtigung", "Bar darf die Gästeliste nicht pflegen", ohne?.ergebnis);

  const { data: max } = await admin.rpc("speichere_gast", {
    p_id: null, p_event_id: ev.id, p_name: "  Max Muster ", p_email: "Max@Example.invalid",
    p_begleitung: 2, p_notiz: "DJ-Freund",
  });
  pruefe(max?.ergebnis === "ok" && /^[0-9a-f]{64}$/.test(max.token), "Admin legt Max +2 an");
  let t = await tickets(max.id);
  pruefe(t.length === 3 && t.every((x) => x.status === "gueltig" && x.phase_name === "Gästeliste"
    && x.bestellung_id === null && x.phase_id === null), "Drei Tickets, ohne Bestellung und Phase");
  pruefe(t[0].gast_name === "Max Muster" && t[2].gast_name === "Max Muster · Begleitung",
    "Name auf dem ersten Ticket, Begleitung auf den anderen", t.map((x) => x.gast_name).join(" | "));

  const { data: adminSieht } = await admin.from("gaeste").select("email").eq("event_id", ev.id);
  const { data: barSieht } = await bar.from("gaeste").select("email").eq("event_id", ev.id);
  const { data: einlassSieht } = await einlass.from("gaeste").select("email").eq("event_id", ev.id);
  pruefe((adminSieht ?? []).length === 1 && adminSieht[0].email === "max@example.invalid",
    "Admin liest die Liste, Adresse klein geschrieben");
  pruefe((barSieht ?? []).length === 0 && (einlassSieht ?? []).length === 0,
    "Bar und Einlass lesen die Tabelle nicht direkt — nur die Namensliste");

  const { data: liste } = await einlass.rpc("gaesteliste_einlass", { p_event_id: ev.id });
  pruefe(liste?.length === 1 && liste[0].personen === 3 && liste[0].drin === 0
    && liste[0].notiz === "DJ-Freund" && !("email" in liste[0]),
    "Namensliste am Einlass: Name, Personen, Notiz — keine Adresse", JSON.stringify(liste?.[0]));
  const { data: barListe } = await bar.rpc("gaesteliste_einlass", { p_event_id: ev.id });
  pruefe(Array.isArray(barListe) && barListe.length === 1, "Bar sieht die Namensliste auch");

  console.log("\n— Einlass: QR und Namensliste über dieselben Tickets —");
  const { data: scan } = await einlass.rpc("entwerte_ticket", { p_code: t[0].code });
  pruefe(scan?.ergebnis === "gueltig" && scan.typ === "Gästeliste" && scan.gast === "Max Muster",
    "QR-Scan lässt den Gast rein und nennt Gästeliste und Name", JSON.stringify(scan));

  const { data: eins } = await einlass.rpc("lasse_gast_ein", { p_gast_id: max.id, p_anzahl: 1 });
  pruefe(eins?.ergebnis === "gueltig" && eins.eingelassen === 1 && eins.drin === 2 && eins.personen === 3,
    "Namensliste: eine Begleitung rein, 2 von 3 drin", JSON.stringify(eins));
  const { data: alle } = await einlass.rpc("lasse_gast_ein", { p_gast_id: max.id, p_anzahl: 5 });
  pruefe(alle?.eingelassen === 1 && alle.drin === 3, "Mehr als übrig: nur der Rest kommt rein", JSON.stringify(alle));
  const { data: nochmal } = await einlass.rpc("lasse_gast_ein", { p_gast_id: max.id, p_anzahl: 1 });
  pruefe(nochmal?.ergebnis === "schon_drin", "Danach: schon drin");
  const { data: scan2 } = await einlass.rpc("entwerte_ticket", { p_code: t[2].code });
  pruefe(scan2?.ergebnis === "schon_entwertet", "Über die Liste Eingelassene fallen beim QR-Scan auf");

  const { data: weniger } = await admin.rpc("speichere_gast", {
    p_id: max.id, p_event_id: ev.id, p_name: "Max Muster", p_email: null, p_begleitung: 0, p_notiz: null,
  });
  pruefe(weniger?.ergebnis === "schon_drin" && weniger.drin === 3,
    "Weniger Personen als schon drin: abgelehnt", JSON.stringify(weniger));

  console.log("\n— Ändern und Entfernen —");
  const { data: lisa } = await admin.rpc("speichere_gast", {
    p_id: null, p_event_id: ev.id, p_name: "Lisa", p_email: null, p_begleitung: 1, p_notiz: null,
  });
  await admin.rpc("speichere_gast", {
    p_id: lisa.id, p_event_id: ev.id, p_name: "Lisa L.", p_email: null, p_begleitung: 3, p_notiz: null,
  });
  t = await tickets(lisa.id);
  pruefe(t.filter((x) => x.status === "gueltig").length === 4 && t[0].gast_name === "Lisa L.",
    "Mehr Begleitung: Tickets kommen dazu, Name wandert mit");
  await admin.rpc("speichere_gast", {
    p_id: lisa.id, p_event_id: ev.id, p_name: "Lisa L.", p_email: null, p_begleitung: 0, p_notiz: null,
  });
  t = await tickets(lisa.id);
  pruefe(t.filter((x) => x.status === "gueltig").length === 1 && t[0].status === "gueltig"
    && t.filter((x) => x.status === "storniert").length === 3,
    "Weniger Begleitung: die jüngsten werden storniert, der Gast behält sein Ticket");

  const { data: entfernt } = await admin.rpc("entferne_gast", { p_id: lisa.id });
  pruefe(entfernt?.ergebnis === "ok", "Admin entfernt Lisa");
  const { data: scan3 } = await einlass.rpc("entwerte_ticket", { p_code: t[0].code });
  const { data: liste3 } = await einlass.rpc("lasse_gast_ein", { p_gast_id: lisa.id, p_anzahl: 1 });
  const { data: liste4 } = await einlass.rpc("gaesteliste_einlass", { p_event_id: ev.id });
  pruefe(scan3?.ergebnis === "storniert" && liste3?.ergebnis === "storniert" && liste4?.length === 1,
    "Entfernt: QR storniert, Namensliste abgewiesen, nicht mehr in der Liste");

  console.log("\n— Tabelle und Öffentlichkeit —");
  const { error: beides } = await dienst.from("tickets").insert({
    event_id: ev.id, phase_name: "X", code: `GT${K}`.toUpperCase(),
  });
  pruefe(Boolean(beides), "Ein Ticket ohne Bestellung und ohne Gast wird abgelehnt");

  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const aufrufe = await Promise.all([
    anon.rpc("speichere_gast", { p_id: null, p_event_id: ev.id, p_name: "X", p_email: null, p_begleitung: 0, p_notiz: null }),
    anon.rpc("gaesteliste_einlass", { p_event_id: ev.id }),
    anon.rpc("lasse_gast_ein", { p_gast_id: max.id, p_anzahl: 1 }),
  ]);
  const { data: anonLesen } = await anon.from("gaeste").select("name");
  pruefe(aufrufe.every((a) => a.error) && (anonLesen ?? []).length === 0,
    "Ohne Anmeldung: keine Funktion, keine Zeile");
}

async function aufraeumen() {
  if (angelegt.event) {
    const { data: gaeste } = await dienst.from("gaeste").select("id").eq("event_id", angelegt.event);
    const ids = (gaeste ?? []).map((g) => g.id);
    if (ids.length) await dienst.from("tickets").delete().in("gast_id", ids);
    await dienst.from("gaeste").delete().eq("event_id", angelegt.event);
    await dienst.from("events").delete().eq("id", angelegt.event);
  }
  for (const id of angelegt.nutzer) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  const { count } = await dienst.from("events").select("id", { count: "exact", head: true })
    .eq("slug", `test-gaeste-${K}`);
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("gaestetest-")).length;
  const sauber = count === 0 && rest === 0;
  console.log(`\nAufgeräumt: ${sauber ? "Event, Gäste, Tickets und Testkonten weg" : `NOCH DA: ${count}/${rest}`}`);
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
