/**
 * Prüft die Kassen-Route der Crew-App (`/api/crew/kasse`) gegen einen
 * laufenden Server — mit echten Sitzungs-Cookies, wie sie das Handy schickt.
 *
 *   npx next start -p 3005
 *   node scripts/crew-kasse-testen.mjs http://localhost:3005
 *
 * Legt ein eigenes Event mit Abendkassen-Phase und zwei Konten (Kasse,
 * Einlass) an und räumt am Ende alles wieder weg. Kartenzahlung wird nur
 * angelegt und abgebrochen — Stripe wird dabei nicht belastet.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const BASIS = process.argv[2] ?? "http://localhost:3005";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OEFFENTLICH =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const K = Date.now().toString(36);
const REF = new URL(URL_).hostname.split(".")[0];

let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? `  ${typeof zusatz === "string" ? zusatz : JSON.stringify(zusatz)}` : ""}`);
  if (!ok) fehler++;
};

const angelegt = { event: null, konten: [] };

async function aufraeumen() {
  if (angelegt.event) {
    const { data: b } = await dienst.from("bestellungen").select("id").eq("event_id", angelegt.event);
    const ids = (b ?? []).map((x) => x.id);
    if (ids.length) {
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    await dienst.from("phasen").delete().eq("event_id", angelegt.event);
    await dienst.from("events").delete().eq("id", angelegt.event);
  }
  for (const id of angelegt.konten) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
}

/** Konto mit Rolle, angemeldet; liefert die Cookies, die @supabase/ssr erwartet. */
async function konto(rolle) {
  const email = `lasttest-kasse-${rolle}-${K}@example.invalid`;
  const { data: k, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  angelegt.konten.push(k.user.id);
  await dienst.from("mitarbeiter").upsert({ user_id: k.user.id, name: `Kassentest ${rolle}`, rolle, aktiv: true });
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: f } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (f) throw f;
  const wert = "base64-" + Buffer.from(JSON.stringify(s.session)).toString("base64url");
  const name = `sb-${REF}-auth-token`;
  const stuecke = wert.match(/.{1,3180}/g);
  return stuecke.length === 1
    ? `${name}=${wert}`
    : stuecke.map((teil, i) => `${name}.${i}=${teil}`).join("; ");
}

async function holen(keks, eventId) {
  const r = await fetch(`${BASIS}/api/crew/kasse?event=${eventId}`, { headers: keks ? { cookie: keks } : {} });
  return { status: r.status, daten: await r.json().catch(() => null) };
}

async function schicken(keks, inhalt) {
  const r = await fetch(`${BASIS}/api/crew/kasse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(keks ? { cookie: keks } : {}) },
    body: JSON.stringify(inhalt),
  });
  return r.json().catch(() => null);
}

const drin = async () =>
  (await dienst.from("einlass_stand").select("drin").eq("event_id", angelegt.event).maybeSingle()).data?.drin ?? 0;

try {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst
    .from("events")
    .insert({
      slug: `kassentest-${K}`, titel: "Kassentest", kategorie: "club", status: "veroeffentlicht",
      beginn: new Date(Date.now() + 2 * 3600000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
      kapazitaet: 10,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.event = ev.id;
  const { data: ph, error: pf } = await dienst
    .from("phasen")
    .insert({
      event_id: ev.id, name: "Abendkasse", art: "standard", preis_cent: 2500, gebuehr_cent: 0,
      kontingent: 5, verkauft: 0, aktiv: true, leistungen: [], position: 0, abendkasse: true,
    })
    .select("id")
    .single();
  if (pf) throw new Error(`Phase: ${pf.message}`);

  const kasse = await konto("kasse");
  const einlass = await konto("einlass");

  console.log("\n— Zugang —");
  pruefe((await holen(null, ev.id)).status === 403, "Ohne Anmeldung: 403");
  pruefe((await holen(einlass, ev.id)).status === 403, "Einlass darf nicht kassieren: 403");
  const verbot = await schicken(einlass, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 1, zahlung: "bar", einlassen: true });
  pruefe(verbot?.ok === false, "Einlass kann nicht verkaufen", verbot?.fehler);

  console.log("\n— Laden —");
  const start = await holen(kasse, ev.id);
  pruefe(start.status === 200 && start.daten?.phasen?.length === 1, "Kasse sieht die Abendkassen-Phase");
  pruefe(start.daten?.phasen?.[0]?.rest === 5, "… mit Rest 5", start.daten?.phasen?.[0]);
  pruefe(start.daten?.stand?.tickets === 0, "Kassenstand leer", start.daten?.stand);

  console.log("\n— Bar, geht jetzt rein —");
  const bar = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 2, zahlung: "bar", einlassen: true });
  pruefe(bar?.ok && bar.eingelassen && bar.gesamtCent === 5000, "2 × bar verkauft und eingelassen", bar);
  pruefe((await drin()) === 2, "drin = 2");
  const nachBar = await holen(kasse, ev.id);
  pruefe(nachBar.daten?.stand?.barCent === 5000 && nachBar.daten?.stand?.tickets === 2, "Kassenstand 50 € bar, 2 Tickets", nachBar.daten?.stand);
  pruefe(nachBar.daten?.phasen?.[0]?.rest === 3, "Rest 3");

  console.log("\n— Bar, für später —");
  const spaeter = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 1, zahlung: "bar", einlassen: false });
  pruefe(spaeter?.ok && !spaeter.eingelassen && String(spaeter.qr).includes("<svg"), "Verkauft, nicht eingelassen, QR mit den Tickets");
  pruefe((await drin()) === 2, "drin bleibt 2");

  console.log("\n— Mehr als übrig —");
  const zuViel = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 3, zahlung: "bar", einlassen: true });
  pruefe(zuViel?.ok === false && /2/.test(zuViel.fehler), "Abgelehnt mit Rest", zuViel?.fehler);

  console.log("\n— Karte: anlegen und abbrechen —");
  const karte = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 1, zahlung: "qr", einlassen: true });
  pruefe(karte?.ok && !karte.bezahlt && String(karte.qr).includes("<svg"), "Zahl-QR erzeugt, noch nicht bezahlt");
  if (karte?.ok) {
    const warte = await schicken(kasse, { schritt: "zahlung", bestellungId: karte.bestellungId, einlassen: true });
    pruefe(warte?.art === "wartet", "Zahlung: wartet", warte);
    pruefe((await drin()) === 2, "Unbezahlt zählt nicht");
    const weg = await schicken(kasse, { schritt: "abbrechen", bestellungId: karte.bestellungId });
    pruefe(weg?.ok === true, "Abgebrochen");
    const danach = await schicken(kasse, { schritt: "zahlung", bestellungId: karte.bestellungId, einlassen: true });
    pruefe(danach?.art === "abgelaufen", "Danach: abgelaufen", danach);
    const frei = await holen(kasse, ev.id);
    pruefe(frei.daten?.phasen?.[0]?.rest === 2, "Ticket wieder frei, Rest 2", frei.daten?.phasen?.[0]);
  }

  console.log("\n— Unsinn —");
  pruefe((await holen(kasse, "")).status === 400, "Ohne Event: 400");
  const kaputt = await fetch(`${BASIS}/api/crew/kasse`, { method: "POST", headers: { cookie: kasse }, body: "kein json" });
  pruefe(kaputt.status === 400, "Kaputte Eingabe: 400");
} catch (e) {
  pruefe(false, "Abbruch", e.message);
} finally {
  await aufraeumen();
}

console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles grün. Aufgeräumt.");
process.exit(fehler ? 1 : 0);
