/**
 * Testbogen für den Scanner am Handy: ein Test-Event mit Tickets und allen
 * Sonderfällen, dazu eine HTML-Seite mit den QR-Codes zum Abscannen vom
 * Bildschirm.
 *
 *   node scripts/einlass-testbogen.mjs anlegen [ausgabe.html] [admin-adresse]
 *   node scripts/einlass-testbogen.mjs weg
 *
 * Beide Events sind Entwürfe: öffentlich unsichtbar, im Scanner sehen sie
 * nur Admins (0048). Auf dem Bogen: gültige Tickets mit Namen (einige mit
 * Fast Lane, eines ohne Namen), ein storniertes, ein schon eingelassenes,
 * eines für ein anderes Event, ein ausgedachter Code und eine
 * Garderobenmarke. Mit admin-adresse wird zusätzlich ein Wegwerf-Admin
 * angelegt (zum Testen im Browser ohne Passwort, Link mit anmeldelink.mjs).
 * Echte Tickets fasst das Skript nicht an.
 */
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { readFileSync, writeFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const dienst = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SLUG = "testbogen-einlass";
const SLUG2 = "testbogen-einlass-anderes";
const KAEUFER = (n) => `testbogen-kaeufer${n}@example.invalid`;
const ADMIN_PREFIX = "testbogen-admin";

async function weg() {
  for (const slug of [SLUG, SLUG2]) {
    const { data: ev } = await dienst.from("events").select("id").eq("slug", slug).maybeSingle();
    if (!ev) continue;
    const { data: b } = await dienst.from("bestellungen").select("id").eq("event_id", ev.id);
    const ids = (b ?? []).map((x) => x.id);
    if (ids.length) {
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    await dienst.from("phasen").delete().eq("event_id", ev.id);
    await dienst.from("events").delete().eq("id", ev.id);
  }
  await dienst.from("kunden").delete().like("email", "testbogen-%@example.invalid");
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  for (const k of konten.users.filter((u) => u.email?.startsWith(ADMIN_PREFIX))) {
    await dienst.from("mitarbeiter").delete().eq("user_id", k.id);
    await dienst.auth.admin.deleteUser(k.id);
  }
  await dienst.from("kunden").delete().like("email", `${ADMIN_PREFIX}%`);
}

async function event(slug, titel, stunden) {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst.from("events").insert({
    slug, titel, kategorie: "club", status: "veroeffentlicht",
    beginn: new Date(Date.now() + stunden * 3600000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (error) throw new Error(`Event: ${error.message}`);
  const phase = async (name, position) => (await dienst.from("phasen").insert({
    event_id: ev.id, name, art: "standard", preis_cent: 2000, gebuehr_cent: 0,
    kontingent: 100, verkauft: 0, aktiv: true, leistungen: [], position,
  }).select("id").single()).data.id;
  return { id: ev.id, eb: await phase("Early Bird", 0) };
}

async function kauf(ev, nr, namen, { fastlane = false } = {}) {
  const { data: id, error } = await dienst.rpc("reserviere", {
    p_event_id: ev.id, p_auswahl: [{ phase_id: ev.eb, menge: namen.length }],
    p_email: KAEUFER(nr), p_vorname: namen[0]?.split(" ")[0] ?? "Ohne", p_nachname: namen[0]?.split(" ")[1] ?? "Name",
  });
  if (error) throw new Error(`reserviere: ${error.message}`);
  await dienst.from("bestellungen").update({ ticket_namen: namen.map((n) => n || null) }).eq("id", id);
  await dienst.rpc("bestaetige_zahlung", { p_bestellung_id: id, p_zahlungsart: "frei", p_referenz: "testbogen" });
  if (fastlane) await dienst.from("tickets").update({ fastlane: true }).eq("bestellung_id", id);
  const { data: t } = await dienst.from("tickets").select("code, gast_name").eq("bestellung_id", id).order("erstellt_am");
  return t;
}

async function anlegen(ausgabe, adminAdresse) {
  await weg();
  const ev = await event(SLUG, "TESTBOGEN", 3);
  const ev2 = await event(SLUG2, "TESTBOGEN ANDERES EVENT", 240);

  const karten = [];
  const vornamen = ["Anna", "Ben", "Cem", "Dora", "Emil", "Fiona", "Gabi", "Hakan", "Ines", "Jonas",
    "Kira", "Leon", "Mila", "Noah", "Olga", "Paul", "Rosa", "Sami"];
  let nr = 0;
  for (let i = 0; i < vornamen.length; i += 3) {
    const gruppe = vornamen.slice(i, i + 3).map((v) => `${v} Test`);
    const fastlane = i % 6 === 0;
    for (const t of await kauf(ev, nr++, gruppe, { fastlane })) {
      karten.push({ code: t.code, titel: t.gast_name, erwartet: fastlane ? "Einlass · Fast Lane" : "Einlass", art: "gut" });
    }
  }
  const [ohneName] = await kauf(ev, nr++, ["Kara Kaeufer", ""]).then((t) => t.slice(1));
  karten.push({ code: ohneName.code, titel: "Ticket ohne Namen", erwartet: "Einlass · Kein Name hinterlegt", art: "gut" });

  const [storno] = await kauf(ev, nr++, ["Stefan Storno"]);
  await dienst.from("tickets").update({ status: "storniert" }).eq("code", storno.code);
  karten.push({ code: storno.code, titel: "Storniert", erwartet: "Storniert (rot)", art: "schlecht" });

  const [schon] = await kauf(ev, nr++, ["Sina Schondrin"]);
  await dienst.from("tickets").update({ status: "entwertet", entwertet_am: new Date().toISOString() }).eq("code", schon.code);
  karten.push({ code: schon.code, titel: "Schon eingelassen", erwartet: "Schon drin (gelb)", art: "schlecht" });

  const [anderes] = await kauf(ev2, nr++, ["Andi Anders"]);
  karten.push({ code: anderes.code, titel: "Ticket für ein anderes Event", erwartet: "Anderes Event (rot), bleibt gültig", art: "schlecht" });

  karten.push({ code: "ZZZZ9999ZZZZ9999ZZZZ", titel: "Ausgedachter Code", erwartet: "Unbekannt (rot)", art: "schlecht" });
  karten.push({ code: "G-TESTBOGEN0000000000", titel: "Garderobenmarke", erwartet: "Hinweis: Garderobenmarke", art: "schlecht" });

  await dienst.from("events").update({ status: "entwurf", kapazitaet: 30 }).in("id", [ev.id, ev2.id]);

  if (adminAdresse) {
    const { data: k, error } = await dienst.auth.admin.createUser({ email: adminAdresse, email_confirm: true });
    if (error) throw error;
    await dienst.from("mitarbeiter").upsert({ user_id: k.user.id, name: "Testbogen Admin", rolle: "admin", aktiv: true });
  }

  const kachel = async (k, i) => `
  <figure class="${k.art}">
    ${await QRCode.toString(k.code, { type: "svg", margin: 1, errorCorrectionLevel: "M" })}
    <figcaption><b>${i + 1}. ${k.titel ?? ""}</b><span>Erwartet: ${k.erwartet}</span><code>${k.code}</code></figcaption>
  </figure>`;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Testbogen Einlass</title>
<style>
  body{font:15px/1.4 system-ui,sans-serif;margin:24px;background:#fff;color:#111}
  h1{font-size:22px;margin:0 0 4px} p{margin:0 0 16px;color:#444;max-width:70ch}
  main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
  figure{margin:0;padding:12px;border:2px solid #16a34a;border-radius:8px;display:flex;flex-direction:column;gap:8px}
  figure.schlecht{border-color:#dc2626}
  svg{width:100%;height:auto;background:#fff}
  figcaption{display:flex;flex-direction:column;gap:2px;font-size:13px}
  code{font-size:11px;color:#666;word-break:break-all}
</style></head><body>
<h1>Testbogen Einlass · Event „TESTBOGEN“ (Entwurf)</h1>
<p>Im Scanner oben „Entwurf · TESTBOGEN“ wählen und die Codes vom Bildschirm scannen. Grün umrandet muss
„Einlass“ zeigen, rot umrandet etwas anderes. Zweimal scannen ergibt „Schon drin“. Zum Offline-Test am Handy
den Flugmodus an, dann scannen, wieder aus: Unten muss „N zum Nachtragen“ erscheinen und verschwinden.
Wegräumen: <code>node scripts/einlass-testbogen.mjs weg</code></p>
<main>${(await Promise.all(karten.map(kachel))).join("")}</main></body></html>`;
  writeFileSync(ausgabe, html);
  console.log(`${karten.length} Codes auf dem Bogen: ${ausgabe}`);
}

const befehl = process.argv[2];
if (befehl === "weg") {
  await weg();
  console.log("Testbogen weggeräumt.");
} else if (befehl === "anlegen") {
  const adminAdresse = process.argv[4];
  if (adminAdresse && !adminAdresse.startsWith(ADMIN_PREFIX)) {
    console.error(`Admin-Adresse muss mit ${ADMIN_PREFIX} beginnen (damit "weg" sie findet).`);
    process.exit(1);
  }
  await anlegen(process.argv[3] ?? "testbogen.html", adminAdresse);
} else {
  console.log("node scripts/einlass-testbogen.mjs anlegen [ausgabe.html] [testbogen-admin…@example.invalid] | weg");
}
