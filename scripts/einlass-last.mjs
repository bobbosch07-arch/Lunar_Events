/**
 * Lasttest für den Einlass: 1000 Tickets, mehrere Geräte gleichzeitig.
 *
 *   node scripts/einlass-last.mjs            # 1000 Tickets, 6 Geräte
 *   node scripts/einlass-last.mjs 300 4      # 300 Tickets, 4 Geräte
 *
 * Auf einem eigenen Test-Event, mit echten Einlass-Sitzungen (entwerte_ticket
 * schaut auf auth.uid()). Gemessen wird der Weg zur Datenbank; auf dem
 * Handy kommt der Weg über Vercel dazu. Geprüft:
 *   1. Alle Tickets, verteilt auf die Geräte, so schnell es geht
 *   2. Doppelscans: jedes zweite Mal "schon drin"
 *   3. Wettlauf: zwei Geräte scannen dasselbe Ticket in derselben Sekunde
 *   4. Sonderfälle: unbekannt, storniert, Ticket eines anderen Events (0048)
 *   5. Daten für den Betrieb ohne Netz (einlass_liste): Größe und Zeit
 *   6. Nur prüfen (Admins): nichts wird entwertet
 *   7. Nachtragen nach Netzausfall: ein Aufruf, Doppelte werden gemeldet
 * Danach muss jedes Ticket genau einmal eingelassen sein. Räumt im finally
 * auf, auch Konten und Kundenzeilen. Das echte Event bleibt unberührt.
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

const ANZAHL = Number(process.argv[2] ?? 1000);
const GERAETE = Number(process.argv[3] ?? 6);
const WETTLAUF = 50;
const K = Date.now().toString(36);
const SLUG = `lasttest-${K}`;
const SLUG2 = `lasttest-anderes-${K}`;
const PERSONAL = (i) => `lasttest-einlass${i}-${K}@example.invalid`;
const KAEUFER = (i) => `lasttest-kaeufer${i}-${K}@example.invalid`;

let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!ok) fehler++;
};
const ms = (n) => `${Math.round(n)} ms`;
function verteilung(zeiten) {
  const s = [...zeiten].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `p50 ${ms(p(0.5))} · p95 ${ms(p(0.95))} · max ${ms(s[s.length - 1])}`;
}

async function sitzung(email) {
  const { data: link, error } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: f } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (f) throw f;
  return client;
}

const angelegt = { events: [], konten: [] };

async function aufraeumen() {
  for (const evId of angelegt.events) {
    const { data: b } = await dienst.from("bestellungen").select("id").eq("event_id", evId);
    const ids = (b ?? []).map((x) => x.id);
    for (let i = 0; i < ids.length; i += 100) {
      const teil = ids.slice(i, i + 100);
      await dienst.from("tickets").delete().in("bestellung_id", teil);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", teil);
      await dienst.from("bestellungen").delete().in("id", teil);
    }
    await dienst.from("phasen").delete().eq("event_id", evId);
    await dienst.from("events").delete().eq("id", evId);
  }
  for (const id of angelegt.konten) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  await dienst.from("kunden").delete().like("email", `lasttest-%-${K}@example.invalid`);
}

async function testEvent(slug, titel) {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst.from("events").insert({
    slug, titel, kategorie: "club", status: "veroeffentlicht",
    beginn: new Date(Date.now() + 2 * 3600000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.events.push(ev.id);
  const { data: ph } = await dienst.from("phasen").insert({
    event_id: ev.id, name: "Early Bird", art: "standard", preis_cent: 2000, gebuehr_cent: 0,
    kontingent: ANZAHL + 500, verkauft: 0, aktiv: true, leistungen: [], position: 0,
  }).select("id").single();
  return { id: ev.id, phase: ph.id };
}

/** Bestellungen zu je bis zu 20 Tickets, mit Namen, über die echte Kette. */
async function kaufe(ev, gesamt, nr0) {
  const bestellungen = [];
  let rest = gesamt;
  let nr = nr0;
  while (rest > 0) {
    const menge = Math.min(rest, [1, 2, 4, 20][nr % 4]);
    bestellungen.push({ nr, menge });
    rest -= menge;
    nr++;
  }
  const codes = [];
  for (let i = 0; i < bestellungen.length; i += 10) {
    const teil = bestellungen.slice(i, i + 10);
    const erg = await Promise.all(teil.map(async ({ nr, menge }) => {
      const { data: id, error } = await dienst.rpc("reserviere", {
        p_event_id: ev.id, p_auswahl: [{ phase_id: ev.phase, menge }],
        p_email: KAEUFER(nr), p_vorname: "Last", p_nachname: `Test${nr}`,
      });
      if (error) throw new Error(`reserviere: ${error.message}`);
      await dienst.from("bestellungen").update({
        ticket_namen: Array.from({ length: menge }, (_, j) => `Gast${nr} Nummer${j + 1}`),
      }).eq("id", id);
      const { error: zf } = await dienst.rpc("bestaetige_zahlung", {
        p_bestellung_id: id, p_zahlungsart: "frei", p_referenz: "lasttest",
      });
      if (zf) throw new Error(`bestaetige_zahlung: ${zf.message}`);
      return id;
    }));
    for (let j = 0; j < erg.length; j += 50) {
      const { data } = await dienst.from("tickets").select("code").in("bestellung_id", erg.slice(j, j + 50));
      codes.push(...(data ?? []).map((t) => t.code));
    }
  }
  return codes;
}

function mische(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function durchspielen() {
  console.log(`Lasttest: ${ANZAHL} Tickets, ${GERAETE} Geräte\n`);
  let t0 = Date.now();
  const ev = await testEvent(SLUG, "LASTTEST");
  const ev2 = await testEvent(SLUG2, "LASTTEST ANDERES EVENT");
  const NACHTRAG = 100;
  const PROBE = 5;
  const codes = mische(await kaufe(ev, ANZAHL + WETTLAUF + NACHTRAG + PROBE + 1, 0));
  const fremd = (await kaufe(ev2, 1, 100000))[0];
  await dienst.from("events").update({ status: "entwurf" }).in("id", [ev.id, ev2.id]);
  const gesamt = codes.length - 1;
  console.log(`Aufgebaut: ${codes.length} Tickets in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

  const storniert = codes.pop();
  await dienst.from("tickets").update({ status: "storniert" }).eq("code", storniert);
  const wettlauf = codes.splice(0, WETTLAUF);
  const nachtrag = codes.splice(0, NACHTRAG);
  const probe = codes.splice(0, PROBE);
  const haupt = codes;

  // --- Geräte (Einlass) und ein Admin ---
  const geraete = [];
  const konto = async (email, rolle, name) => {
    const { data: k, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    angelegt.konten.push(k.user.id);
    await dienst.from("mitarbeiter").upsert({ user_id: k.user.id, name, rolle, aktiv: true });
    return sitzung(email);
  };
  for (let i = 0; i < GERAETE; i++) geraete.push(await konto(PERSONAL(i), "einlass", `Lasttest ${i}`));
  const admin = await konto(PERSONAL("admin"), "admin", "Lasttest Admin");

  // Wie der Scanner seit 0048: mit dem gewählten Event.
  const scan = (g, code, opt = {}) =>
    g.rpc("entwerte_ticket", { p_code: code, p_event_id: ev.id, ...opt });

  // --- 5. Daten für ohne Netz ---
  console.log("— Daten für den Betrieb ohne Netz —");
  t0 = Date.now();
  const { data: liste, error: lF } = await geraete[0].rpc("einlass_liste", { p_event_id: ev.id });
  const tListe = Date.now() - t0;
  pruefe(!lF && liste?.gueltig?.length === gesamt && Object.keys(liste?.namen ?? {}).length === gesamt,
    `Liste vollständig (über 1000): ${liste?.gueltig?.length} gültig, ${Object.keys(liste?.namen ?? {}).length} Namen`,
    `${ms(tListe)}, ${(JSON.stringify(liste).length / 1024).toFixed(1)} KB` + (lF ? ` ${lF.message}` : ""));
  const { data: summen } = await geraete[0].rpc("einlass_pruefsummen", { p_event_id: ev.id });
  pruefe(summen?.length === gesamt, "Alte Prüfsummen-Abfrage ohne 1000er-Grenze", `${summen?.length}`);
  const { data: fremdListe } = await dienst.rpc("einlass_liste", { p_event_id: ev.id });
  pruefe(fremdListe?.gueltig?.length === 0, "Ohne Einlass-Anmeldung: leere Liste");

  // --- 1. Alle Tickets, so schnell es geht ---
  console.log("\n— 1. Durchlauf —");
  const zeiten = [];
  const ergebnisse = {};
  const rpcFehler = [];
  t0 = Date.now();
  await Promise.all(geraete.map(async (g, i) => {
    for (let n = i; n < haupt.length; n += GERAETE) {
      const s = performance.now();
      const { data, error } = await scan(g, haupt[n]);
      zeiten.push(performance.now() - s);
      if (error) rpcFehler.push(error.message);
      else ergebnisse[data.ergebnis] = (ergebnisse[data.ergebnis] ?? 0) + 1;
    }
  }));
  const dauer = (Date.now() - t0) / 1000;
  pruefe(ergebnisse.gueltig === haupt.length && rpcFehler.length === 0,
    `${haupt.length} Scans, alle "Einlass"`, JSON.stringify(ergebnisse) + (rpcFehler.length ? ` Fehler: ${rpcFehler[0]}` : ""));
  console.log(`  Dauer ${dauer.toFixed(1)} s · ${(haupt.length / dauer).toFixed(0)} Scans/s · ${verteilung(zeiten)}`);

  // --- 2. Doppelscans ---
  console.log("\n— 2. Doppelscans —");
  const nochmal = mische([...haupt]).slice(0, Math.min(200, haupt.length));
  const doppelt = {};
  await Promise.all(geraete.map(async (g, i) => {
    for (let n = i; n < nochmal.length; n += GERAETE) {
      const { data } = await scan(g, nochmal[n]);
      doppelt[data.ergebnis] = (doppelt[data.ergebnis] ?? 0) + 1;
      if (data.ergebnis === "schon_entwertet" && (!data.zeitpunkt || !data.gast)) doppelt.ohneDetails = (doppelt.ohneDetails ?? 0) + 1;
    }
  }));
  pruefe(doppelt.schon_entwertet === nochmal.length && !doppelt.ohneDetails,
    `${nochmal.length} Doppelscans: alle "Schon drin" mit Zeit und Name`, JSON.stringify(doppelt));

  // --- 3. Wettlauf ---
  console.log("\n— 3. Wettlauf: drei Geräte, dasselbe Ticket, gleichzeitig —");
  let einmalRein = 0;
  const wettZeiten = [];
  for (const code of wettlauf) {
    const s = performance.now();
    const antworten = await Promise.all(geraete.slice(0, 3).map((g) => scan(g, code)));
    wettZeiten.push(performance.now() - s);
    if (antworten.filter((a) => a.data?.ergebnis === "gueltig").length === 1) einmalRein++;
  }
  pruefe(einmalRein === wettlauf.length, `${wettlauf.length} Tickets: jeweils genau ein Gerät lässt rein`,
    `${einmalRein}/${wettlauf.length} · ${verteilung(wettZeiten)}`);

  // --- 4. Sonderfälle ---
  console.log("\n— 4. Sonderfälle —");
  const fall = async (code) => (await scan(geraete[0], code)).data;
  pruefe((await fall("ZZZZZZZZZZZZZZZZZZZZ")).ergebnis === "unbekannt", "Ausgedachter Code: Unbekannt");
  pruefe((await fall(storniert)).ergebnis === "storniert", "Storniertes Ticket: Storniert");
  pruefe((await fall(` ${haupt[0].toLowerCase()} `)).ergebnis === "schon_entwertet", "Kleingeschrieben mit Leerzeichen: erkannt");
  const anderes = await fall(fremd);
  pruefe(anderes.ergebnis === "anderes_event" && anderes.event === "LASTTEST ANDERES EVENT" && Boolean(anderes.beginn),
    "Ticket eines anderen Events: abgewiesen mit Titel und Datum", `${anderes.ergebnis} (${anderes.event})`);
  const { data: fremdDanach } = await dienst.from("tickets").select("status").eq("code", fremd).single();
  pruefe(fremdDanach.status === "gueltig", "… und bleibt für sein Event gültig", fremdDanach.status);
  const { data: ohneEvent } = await geraete[0].rpc("entwerte_ticket", { p_code: "ZZZZZZZZZZZZZZZZZZZY" });
  pruefe(ohneEvent?.ergebnis === "unbekannt", "Alter Aufruf nur mit Code geht weiter (laufender Code)");

  // --- 6. Nur prüfen ---
  console.log("\n— 6. Nur prüfen —");
  const proben = await Promise.all(probe.map((c) => scan(admin, c, { p_nur_pruefen: true })));
  pruefe(proben.every((p) => p.data?.ergebnis === "gueltig" && p.data?.probe === true && p.data?.gast),
    `Admin prüft ${probe.length} Tickets: gültig, mit Namen`);
  const { count: nochGueltig } = await dienst.from("tickets").select("id", { count: "exact", head: true })
    .in("code", probe).eq("status", "gueltig");
  pruefe(nochGueltig === probe.length, "… und keines wurde entwertet", `${nochGueltig}/${probe.length}`);
  const { data: probeFremd } = await admin.rpc("entwerte_ticket", { p_code: fremd, p_event_id: null, p_nur_pruefen: true });
  pruefe(probeFremd?.ergebnis === "gueltig" && probeFremd?.event === "LASTTEST ANDERES EVENT",
    "Prüfen ohne Event erklärt auch Tickets anderer Events", `${probeFremd?.ergebnis} (${probeFremd?.event})`);
  const { data: probeEinlass } = await scan(geraete[0], probe[0], { p_nur_pruefen: true });
  pruefe(probeEinlass?.ergebnis === "keine_berechtigung", "Einlass-Personal darf nicht nur prüfen");

  // --- 7. Nachtragen nach Netzausfall ---
  console.log("\n— 7. Nachtragen: 100 Scans ohne Netz, 10 davon war ein anderes Gerät schneller —");
  await Promise.all(nachtrag.slice(0, 10).map((c) => scan(geraete[1], c)));
  t0 = Date.now();
  const { data: nach1, error: n1F } = await geraete[0].rpc("einlass_nachtragen", { p_codes: nachtrag, p_event_id: ev.id });
  const tNach = Date.now() - t0;
  const rein1 = (nach1 ?? []).filter((a) => a.ergebnis === "gueltig").length;
  const fremdDoppelt = (nach1 ?? []).filter((a) => a.ergebnis === "schon_entwertet" && !a.eigenes).length;
  pruefe(!n1F && rein1 === 90 && fremdDoppelt === 10,
    "Ein Aufruf: 90 nachgetragen, 10 als zweimal drin gemeldet", `${ms(tNach)}` + (n1F ? ` ${n1F.message}` : ""));
  const { data: nach2 } = await geraete[0].rpc("einlass_nachtragen", { p_codes: nachtrag, p_event_id: ev.id });
  const eigene = (nach2 ?? []).filter((a) => a.ergebnis === "schon_entwertet" && a.eigenes).length;
  pruefe(eigene === 90, "Nochmal nachgetragen (Antwort kam doch an): 90 als eigene erkannt, kein Alarm", `${eigene}`);
  const { error: zuViel } = await geraete[0].rpc("einlass_nachtragen", {
    p_codes: Array.from({ length: 501 }, () => "X"), p_event_id: ev.id,
  });
  pruefe(Boolean(zuViel), "Mehr als 500 auf einmal abgelehnt");

  // --- Endstand in der Datenbank ---
  console.log("\n— Endstand —");
  const { count: drin } = await dienst.from("tickets").select("id", { count: "exact", head: true })
    .eq("event_id", ev.id).eq("status", "entwertet");
  const { count: ohneWer } = await dienst.from("tickets").select("id", { count: "exact", head: true })
    .eq("event_id", ev.id).eq("status", "entwertet").is("entwertet_von", null);
  pruefe(drin === gesamt - PROBE, "Jedes Ticket genau einmal eingelassen, geprüfte nicht", `${drin} von ${gesamt}`);
  pruefe(ohneWer === 0, "Bei jedem steht, welches Gerät gescannt hat");
}

try {
  await durchspielen();
} catch (f) {
  console.error("\nAbgebrochen:", f.message ?? f);
  fehler++;
} finally {
  await aufraeumen().catch((f) => console.error("Aufräumen:", f.message));
  console.log(fehler ? `\n${fehler} Fehler. Aufgeräumt.` : "\nAlles grün. Aufgeräumt.");
  process.exit(fehler ? 1 : 0);
}
