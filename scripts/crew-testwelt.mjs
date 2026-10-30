/**
 * Testwelt für die Crew-App am iPhone: ein Test-Event mit allem, was die
 * App kann, und fünf Konten mit Passwort (Admin, Kasse, Einlass, Garderobe,
 * Security) — je eines pro Blickwinkel.
 *
 *   node scripts/crew-testwelt.mjs anlegen
 *   node scripts/crew-testwelt.mjs weg
 *
 * Das Event ist **veröffentlicht** (entschieden 30.10.): Die Kasse verkauft
 * nur bei veröffentlichten Events, und außer Admins sieht das Personal in der
 * App keine Entwürfe. Online kaufen lässt es sich trotzdem nicht — die
 * einzige aktive Phase gibt es nur an der Abendkasse. Steht aber, solange es
 * existiert, auf der Website. Deshalb nach dem Test: `weg`.
 *
 * Zugangsdaten und QR-Codes stehen in `crew-testwelt.local.html` (von git
 * ignoriert) — nie in einer Ausgabe, die irgendwo mitgeschnitten wird.
 * Echte Daten fasst das Skript nicht an.
 */
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OEFFENTLICH =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SLUG = "crew-testwelt";
const SLUG2 = "crew-testwelt-anderes";
const PREFIX = "crewtest-";
const MAIL = (teil) => `${PREFIX}${teil}@example.invalid`;
const AUSGABE = "crew-testwelt.local.html";
const STUNDE = 3600000;

const KONTEN = [
  { rolle: "admin", name: "Test Admin", station: "Abendleitung", sieht: "Scanner, Gäste, Kasse, Mein Plan mit Team heute" },
  { rolle: "kasse", name: "Test Kasse", station: "Abendkasse", sieht: "Scanner, Kasse, Mein Plan" },
  { rolle: "einlass", name: "Test Einlass", station: "Haupteingang", sieht: "Scanner, Gäste, Mein Plan" },
  { rolle: "garderobe", name: "Test Garderobe", station: "Garderobe links", sieht: "Garderobe, Mein Plan" },
  { rolle: "security", name: "Test Security", station: "Tür", sieht: "nur Mein Plan" },
];

async function weg() {
  for (const slug of [SLUG, SLUG2]) {
    const { data: ev } = await dienst.from("events").select("id").eq("slug", slug).maybeSingle();
    if (!ev) continue;
    await dienst.from("tickets").delete().eq("event_id", ev.id);
    const { data: b } = await dienst.from("bestellungen").select("id").eq("event_id", ev.id);
    const ids = (b ?? []).map((x) => x.id);
    if (ids.length) {
      await dienst.from("garderobe_marken").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    await dienst.from("gaeste").delete().eq("event_id", ev.id);
    await dienst.from("schichten").delete().eq("event_id", ev.id);
    await dienst.from("phasen").delete().eq("event_id", ev.id);
    const { error } = await dienst.from("events").delete().eq("id", ev.id);
    if (error) console.error(`Event ${slug} blieb stehen: ${error.message}`);
  }
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  for (const k of konten.users.filter((u) => u.email?.startsWith(PREFIX))) {
    await dienst.from("schichten").delete().eq("user_id", k.id);
    await dienst.from("mitarbeiter").delete().eq("user_id", k.id);
    await dienst.auth.admin.deleteUser(k.id);
  }
  await dienst.from("kunden").delete().like("email", `${PREFIX}%`);
}

async function event(slug, titel, stunden, extra = {}) {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst
    .from("events")
    .insert({
      slug, titel, kategorie: "club", status: "veroeffentlicht",
      beginn: new Date(Date.now() + stunden * STUNDE).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  const { data: ph, error: pf } = await dienst
    .from("phasen")
    .insert({
      event_id: ev.id, name: "Testtickets", art: "standard", preis_cent: 2000, gebuehr_cent: 0,
      kontingent: 100, verkauft: 0, aktiv: true, leistungen: [], position: 0,
    })
    .select("id")
    .single();
  if (pf) throw new Error(`Phase: ${pf.message}`);
  return { id: ev.id, phase: ph.id };
}

let kaufNr = 0;
async function kauf(ev, namen, { fastlane = false, garderobe = 0 } = {}) {
  const nr = kaufNr++;
  const { data: id, error } = await dienst.rpc("reserviere", {
    p_event_id: ev.id, p_auswahl: [{ phase_id: ev.phase, menge: namen.length }], p_email: MAIL(`kaeufer${nr}`),
    p_vorname: namen[0]?.split(" ")[0] || "Ohne", p_nachname: namen[0]?.split(" ")[1] || "Name",
    p_garderobe: garderobe,
  });
  if (error) throw new Error(`reserviere: ${error.message}`);
  await dienst.from("bestellungen").update({ ticket_namen: namen.map((n) => n || null) }).eq("id", id);
  const { error: bf } = await dienst.rpc("bestaetige_zahlung", { p_bestellung_id: id, p_zahlungsart: "frei", p_referenz: "crew-testwelt" });
  if (bf) throw new Error(`bestaetige_zahlung: ${bf.message}`);
  // Fast Lane bräuchte ein eigenes Kontingent am Event — fürs Testen reicht die Markierung.
  if (fastlane) await dienst.from("tickets").update({ fastlane: true }).eq("bestellung_id", id);
  const { data: tickets } = await dienst.from("tickets").select("code, gast_name, fastlane").eq("bestellung_id", id).order("erstellt_am");
  const { data: marken } = await dienst.from("garderobe_marken").select("id, code").eq("bestellung_id", id).order("erstellt_am");
  return { id, tickets: tickets ?? [], marken: marken ?? [] };
}

async function anmelden(email, passwort) {
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: passwort });
  if (error) throw new Error(`Anmeldung ${email}: ${error.message}`);
  return client;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[z]);

async function anlegen() {
  await weg();

  const ev = await event(SLUG, "TEST Crew-App · nicht kaufen", 3, {
    kapazitaet: 30, einlass_modus: "entscheiden", abendkasse: true,
    garderobe_aktiv: true, garderobe_preis_cent: 200, garderobe_kontingent: 50,
  });
  const ev2 = await event(SLUG2, "TEST Crew-App · anderes Event", 240);

  // --- Konten mit Passwort und je eine Schicht ---
  const konten = [];
  for (const k of KONTEN) {
    const email = MAIL(k.rolle);
    const passwort = randomBytes(9).toString("base64url");
    const { data: u, error } = await dienst.auth.admin.createUser({ email, password: passwort, email_confirm: true });
    if (error) throw new Error(`Konto ${email}: ${error.message}`);
    await dienst.from("mitarbeiter").upsert({ user_id: u.user.id, name: k.name, rolle: k.rolle, aktiv: true });
    konten.push({ ...k, id: u.user.id, email, passwort });
  }
  const t0 = Date.now();
  const { error: sf } = await dienst.from("schichten").insert([
    ...konten.map((k, i) => ({
      event_id: ev.id, user_id: k.id, rolle: k.rolle === "garderobe" ? "einlass" : k.rolle,
      station: k.station, beginn: new Date(t0 - STUNDE).toISOString(), ende: new Date(t0 + 6 * STUNDE).toISOString(),
      pause_min: 30, notiz: i === 2 ? "Leitung: Test Admin\nAusweise genau ansehen." : null,
      eingecheckt_am: i === 0 ? new Date(t0 - 50 * 60000).toISOString() : null,
    })),
    // Eine Schicht für später, damit „Nächste Schichten“ etwas zeigt.
    { event_id: ev.id, user_id: konten[4].id, rolle: "security", station: "Hinterausgang",
      beginn: new Date(t0 + 30 * STUNDE).toISOString(), ende: new Date(t0 + 36 * STUNDE).toISOString(), pause_min: 20 },
  ]);
  if (sf) throw new Error(`Schichten: ${sf.message}`);

  // --- Tickets: alle Fälle des Scanners ---
  const karten = [];
  const vornamen = ["Anna", "Ben", "Cem", "Dora", "Emil", "Fiona", "Gabi", "Hakan", "Ines", "Jonas", "Kira", "Leon"];
  const marken = [];
  for (let i = 0; i < vornamen.length; i += 3) {
    const gruppe = vornamen.slice(i, i + 3).map((v) => `${v} Test`);
    const fastlane = i === 0;
    const k = await kauf(ev, gruppe, { fastlane, garderobe: i === 3 ? 2 : i === 6 ? 1 : 0 });
    for (const t of k.tickets) {
      karten.push({ gruppe: "Einlass", code: t.code, titel: t.gast_name, erwartet: t.fastlane ? "Gültig · Fast Lane" : "Gültig", art: "gut" });
    }
    marken.push(...k.marken.map((m) => ({ ...m, name: gruppe[0] })));
  }
  const ohne = await kauf(ev, ["Kara Kaeufer", ""]);
  karten.push({ gruppe: "Einlass", code: ohne.tickets[1].code, titel: "Ticket ohne Namen", erwartet: "Gültig · Kein Name hinterlegt", art: "gut" });

  const storno = await kauf(ev, ["Stefan Storno"]);
  await dienst.from("tickets").update({ status: "storniert" }).eq("code", storno.tickets[0].code);
  karten.push({ gruppe: "Einlass", code: storno.tickets[0].code, titel: "Storniert", erwartet: "Storniert (rot)", art: "schlecht" });

  const schon = await kauf(ev, ["Sina Schondrin"]);
  await dienst.from("tickets").update({ status: "entwertet", entwertet_am: new Date(t0 - 20 * 60000).toISOString(), entwertet_von: konten[0].id }).eq("code", schon.tickets[0].code);
  karten.push({ gruppe: "Einlass", code: schon.tickets[0].code, titel: "Schon eingelassen", erwartet: "Schon drin (Bernstein)", art: "schlecht" });

  const anderes = await kauf(ev2, ["Andi Anders"]);
  karten.push({ gruppe: "Einlass", code: anderes.tickets[0].code, titel: "Ticket für ein anderes Event", erwartet: "Anderes Event (rot)", art: "schlecht" });
  karten.push({ gruppe: "Einlass", code: "ZZZZ9999ZZZZ9999ZZZZ", titel: "Ausgedachter Code", erwartet: "Unbekannt (rot)", art: "schlecht" });

  // --- Garderobe: eine Marke hängt schon (seit 10 Minuten), die anderen sind offen ---
  if (marken[0]) {
    await dienst.from("garderobe_marken").update({ nummer: "214", abgegeben_am: new Date(t0 - 10 * 60000).toISOString(), abgegeben_von: konten[3].id }).eq("id", marken[0].id);
  }
  marken.forEach((m, i) =>
    karten.push({
      gruppe: "Garderobe", code: m.code, titel: `Marke · ${m.name}`,
      erwartet: i === 0 ? "Bügel holen: 214 (Abholung mit einem Scan)" : "Abgabe: Bügelnummer eintippen", art: "gut",
    }),
  );
  if (karten.some((k) => k.gruppe === "Einlass")) {
    karten.push({ gruppe: "Garderobe", code: karten[0].code, titel: "Ein Ticket an der Garderobe", erwartet: "„Das ist ein Ticket“", art: "schlecht" });
  }

  // --- Gästeliste (über die echte Funktion, angemeldet als Test-Admin) ---
  const admin = await anmelden(konten[0].email, konten[0].passwort);
  for (const g of [
    { p_name: "Gina Gästeliste", p_begleitung: 2, p_notiz: "Freundin vom DJ" },
    { p_name: "DJ Testo", p_begleitung: 0, p_notiz: "Künstler" },
    { p_name: "Familie Probe", p_begleitung: 3, p_notiz: null },
  ]) {
    const { data, error } = await admin.rpc("speichere_gast", { p_id: null, p_event_id: ev.id, p_email: null, ...g });
    if (error || data?.ergebnis !== "ok") throw new Error(`Gast ${g.p_name}: ${error?.message ?? data?.ergebnis}`);
  }

  // --- Online nicht mehr kaufbar: nur die Abendkasse bleibt ---
  await dienst.from("phasen").update({ aktiv: false }).in("event_id", [ev.id, ev2.id]);
  const { error: af } = await dienst.from("phasen").insert({
    event_id: ev.id, name: "Abendkasse", art: "standard", preis_cent: 1000, gebuehr_cent: 0,
    kontingent: 20, verkauft: 0, aktiv: true, leistungen: [], position: 1, abendkasse: true,
  });
  if (af) throw new Error(`Abendkassen-Phase: ${af.message}`);
  await dienst.from("events").update({ status: "entwurf" }).eq("id", ev2.id);

  // --- Bogen ---
  const kachel = async (k, i) => `
    <figure class="${k.art}">
      ${await QRCode.toString(k.code, { type: "svg", margin: 1, errorCorrectionLevel: "M" })}
      <figcaption><b>${i + 1}. ${esc(k.titel)}</b><span>Erwartet: ${esc(k.erwartet)}</span><code>${esc(k.code)}</code></figcaption>
    </figure>`;
  const abschnitt = async (gruppe) => {
    const liste = karten.filter((k) => k.gruppe === gruppe);
    return `<h2>${gruppe}</h2><main>${(await Promise.all(liste.map(kachel))).join("")}</main>`;
  };
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crew-App Testwelt</title>
<style>
  body{font:15px/1.45 system-ui,sans-serif;margin:24px;background:#fff;color:#111}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 10px}
  p,li{max-width:75ch;color:#333} ol{padding-left:20px}
  table{border-collapse:collapse;margin:8px 0 4px} td,th{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top}
  td code{font-size:14px;user-select:all}
  main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
  figure{margin:0;padding:12px;border:2px solid #16a34a;border-radius:8px;display:flex;flex-direction:column;gap:8px}
  figure.schlecht{border-color:#dc2626}
  svg{width:100%;height:auto;background:#fff}
  figcaption{display:flex;flex-direction:column;gap:2px;font-size:13px}
  figcaption code{font-size:11px;color:#666;word-break:break-all}
  .warn{background:#fff4d6;border:1px solid #f0c040;padding:10px 12px;border-radius:6px;max-width:75ch}
</style></head><body>
<h1>Crew-App Testwelt · „TEST Crew-App · nicht kaufen“</h1>
<p class="warn">Das Event ist veröffentlicht und steht auf der Website, bis es weggeräumt ist. Online kaufen geht nicht.
Nach dem Test: <code>node scripts/crew-testwelt.mjs weg</code> — das löscht Event, Tickets, Konten und alles, was beim Test dazukam.
Diese Datei enthält Passwörter. Nicht weitergeben.</p>

<h2>Konten</h2>
<p>Am iPhone in Safari <b>lunar-events.de/crew</b> öffnen, „Teilen → Zum Home-Bildschirm“,
dann die App vom Home-Bildschirm starten und mit Mail und Passwort anmelden. Zum Wechseln: Mein Plan → Abmelden.</p>
<table><tr><th>Rolle</th><th>E-Mail</th><th>Passwort</th><th>sieht</th></tr>
${konten.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.email)}</code></td><td><code>${esc(k.passwort)}</code></td><td>${esc(k.sieht)}</td></tr>`).join("")}
</table>

<h2>Was ausprobieren</h2>
<ol>
  <li><b>Scanner</b> (Admin oder Einlass): Event oben „TEST Crew-App“. Grün umrandete Codes zeigen „Gültig“ mit Namen →
    Reinlassen (Funkeln, Zahl unten steigt) oder Abweisen (zählt nicht). Danach Rückgängig. Rot umrandete zeigen etwas anderes.
    Dasselbe Ticket zweimal reinlassen ergibt „Schon drin“.</li>
  <li><b>Ohne Netz:</b> Flugmodus an, App neu starten (muss trotzdem aufgehen), scannen und reinlassen, Flugmodus aus:
    Unten „N offen“ muss verschwinden.</li>
  <li><b>Gäste</b> (Admin oder Einlass): „Familie Probe“ hat 4 Personen. „Nur 1“ und „Einlassen · n“, dann Rückgängig im Band oben.</li>
  <li><b>Kasse</b> (Admin oder Kasse): Kapazität ist 30. Bar: zweimal tippen. „Für später“ zeigt einen QR mit den Tickets.
    Karte nur, wenn Stripe eingerichtet ist — dann Abbrechen. Die Ampel oben springt bei wenig Platz auf Gelb, bei voll auf Rot.</li>
  <li><b>Garderobe</b> (nur Konto Garderobe): erste Marke = Abholung (Bügel 214), die anderen = Abgabe mit Tastenfeld.
    Suchen oben rechts. Dasselbe Ticket zweimal schnell scannen darf nichts doppelt tun.</li>
  <li><b>Mein Plan</b> (alle): eigene Schicht mit Notiz. Beim Admin darunter „Team heute“: Einchecken, Auschecken, Zurücksetzen.
    Security sieht nur den Plan und eine zweite Schicht für morgen.</li>
  <li><b>Zwei Handys</b> gleichzeitig (Admin + Einlass): Die Zahl „drin“ muss auf beiden live mitlaufen.</li>
</ol>
${await abschnitt("Einlass")}
${await abschnitt("Garderobe")}
</body></html>`;
  writeFileSync(AUSGABE, html);
  console.log(`Angelegt: Event, ${konten.length} Konten, ${karten.length} Codes, 3 Gäste, ${marken.length} Garderobenmarken.`);
  console.log(`Zugangsdaten und Codes: ${AUSGABE} (von git ignoriert).`);
}

const befehl = process.argv[2];
if (befehl === "weg") {
  await weg();
  console.log("Testwelt weggeräumt.");
} else if (befehl === "anlegen") {
  try {
    await anlegen();
  } catch (e) {
    console.error(`Abgebrochen: ${e.message}\nRäume halb Angelegtes weg …`);
    await weg();
    process.exit(1);
  }
} else {
  console.log("node scripts/crew-testwelt.mjs anlegen | weg");
}
