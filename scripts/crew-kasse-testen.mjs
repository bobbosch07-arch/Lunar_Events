/**
 * Prüft die Kassen-Route der Crew-App (`/api/crew/kasse`) gegen einen
 * laufenden Server — mit echten Sitzungs-Cookies, wie sie das Handy schickt.
 *
 *   KASSE_PAYPAL_ME=lunartest KASSE_IBAN=DE89370400440532013000 \
 *   KASSE_KONTOINHABER="Lunar Test" npx next start -p 3005
 *   node scripts/crew-kasse-testen.mjs http://localhost:3005
 *
 * Die Werte für PayPal und Überweisung sind Beispiele (DE89… ist die
 * offizielle Muster-IBAN) — es fließt kein Geld, gebucht wird nur bei uns.
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

  // --- PayPal und Überweisung direkt (0052) ---
  // Braucht am Server KASSE_PAYPAL_ME und KASSE_IBAN/KASSE_KONTOINHABER
  // (siehe Kopf); sonst sind beide Wege aus und der Abschnitt meldet das.
  console.log("\n— PayPal und Überweisung direkt —");
  await dienst.from("phasen").update({ kontingent: 20 }).eq("id", ph.id);
  const wege = await holen(kasse, ev.id);
  if (!wege.daten?.paypalDirekt || !wege.daten?.ueberweisung) {
    pruefe(false, "Server ohne KASSE_PAYPAL_ME / KASSE_IBAN gestartet — Abschnitt übersprungen", wege.daten);
  } else {
    pruefe(true, "Beide Wege eingerichtet");
    const drinVorher = await drin();

    const pp = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 1, zahlung: "paypal", einlassen: true });
    pruefe(pp?.ok && !pp.bezahlt && pp.direkt?.art === "paypal", "PayPal: Bestellung offen angelegt", pp?.direkt);
    pruefe(pp?.direkt?.link === "https://paypal.me/lunartest/25.00EUR", "… paypal.me-Link mit Betrag", pp?.direkt?.link);
    pruefe(String(pp?.qr).includes("<svg") && pp?.direkt?.verwendungszweck === pp?.nummer, "… QR und Bestellnummer als Nachricht");
    pruefe((await drin()) === drinVorher, "Noch nicht bestätigt: zählt nicht");

    const fremd = await schicken(einlass, { schritt: "bestaetigen", bestellungId: pp.bestellungId, einlassen: true });
    pruefe(fremd?.ok === false, "Einlass kann nicht bestätigen", fremd?.fehler);

    const ok = await schicken(kasse, { schritt: "bestaetigen", bestellungId: pp.bestellungId, einlassen: true });
    pruefe(ok?.ok && ok.eingelassen === 1, "Zahlung gesehen: bezahlt und eingelassen", ok);
    pruefe((await drin()) === drinVorher + 1, "drin +1");
    const nochmal = await schicken(kasse, { schritt: "bestaetigen", bestellungId: pp.bestellungId, einlassen: true });
    const { count: ppTickets } = await dienst.from("tickets").select("*", { count: "exact", head: true }).eq("bestellung_id", pp.bestellungId);
    pruefe(nochmal?.ok && ppTickets === 1, "Doppelt getippt: keine doppelten Tickets", ppTickets);
    const { data: ppB } = await dienst.from("bestellungen").select("status, zahlungsart, zahlung_ref").eq("id", pp.bestellungId).single();
    pruefe(ppB.status === "bezahlt" && ppB.zahlungsart === "paypal_direkt" && ppB.zahlung_ref?.startsWith("kasse:"), "Bestellung: paypal_direkt, wer bestätigt hat, steht dran", ppB);

    const ue = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 2, zahlung: "ueberweisung", einlassen: false });
    pruefe(ue?.ok && ue.direkt?.art === "ueberweisung" && ue.direkt.iban === "DE89 3704 0044 0532 0130 00", "Überweisung: GiroCode, IBAN lesbar", ue?.direkt);
    pruefe(ue?.direkt?.verwendungszweck?.startsWith(ue?.nummer), "… Bestellnummer im Verwendungszweck", ue?.direkt?.verwendungszweck);
    const ueOk = await schicken(kasse, { schritt: "bestaetigen", bestellungId: ue.bestellungId, einlassen: false });
    pruefe(ueOk?.ok && ueOk.eingelassen === 0 && String(ueOk.qr).includes("<svg"), "Für später: bezahlt, nicht drin, QR mit den Tickets", ueOk?.eingelassen);
    pruefe((await drin()) === drinVorher + 1, "drin unverändert");

    const weg = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 1, zahlung: "paypal", einlassen: true });
    await schicken(kasse, { schritt: "abbrechen", bestellungId: weg.bestellungId });
    const zuSpaet = await schicken(kasse, { schritt: "bestaetigen", bestellungId: weg.bestellungId, einlassen: true });
    pruefe(zuSpaet?.ok === false && /abgelaufen|abgebrochen/.test(zuSpaet.fehler), "Abgebrochen: lässt sich nicht mehr bestätigen", zuSpaet?.fehler);

    const barB = await schicken(kasse, { schritt: "bestaetigen", bestellungId: bar.bestellungId, einlassen: true });
    pruefe(barB?.ok === false, "Bar-Bestellung über „Zahlung gesehen“: abgelehnt", barB?.fehler);

    const st = (await holen(kasse, ev.id)).daten?.stand;
    pruefe(st?.paypalDirektCent === 2500 && st?.ueberweisungCent === 5000 && st?.barCent === 7500, "Kassenstand getrennt: PayPal 25 €, Überweisung 50 €, Bar 75 €", st);
  }

  // --- Garderobe an der Abendkasse (0053) ---
  console.log("\n— Garderobe an der Abendkasse —");
  pruefe((await holen(kasse, ev.id)).daten?.garderobeCent === null, "Aus: kein Garderoben-Preis");
  const aus = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: "", menge: 0, zahlung: "bar", einlassen: true, garderobe: 1 });
  pruefe(aus?.ok === false && /nicht verkauft/.test(aus.fehler), "Aus: Verkauf abgelehnt", aus?.fehler);

  await dienst.from("events").update({ garderobe_abendkasse: true, garderobe_preis_cent: 200 }).eq("id", ev.id);
  pruefe((await holen(kasse, ev.id)).daten?.garderobeCent === 200, "An: 2 € je Stück");
  const drinG = await drin();
  const { count: markenVorher } = await dienst.from("garderobe_marken").select("*", { count: "exact", head: true }).eq("event_id", ev.id);

  const nurG = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: "", menge: 0, zahlung: "bar", einlassen: true, garderobe: 2 });
  pruefe(nurG?.ok && nurG.gesamtCent === 400 && nurG.garderobe === 2 && !nurG.eingelassen, "Nur Garderobe, 2 Stück bar: 4 €, niemand eingelassen", nurG);
  const { count: nurGTickets } = await dienst.from("tickets").select("*", { count: "exact", head: true }).eq("bestellung_id", nurG.bestellungId);
  pruefe(nurGTickets === 0 && (await drin()) === drinG, "… keine Tickets, drin unverändert");

  const mitT = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: ph.id, menge: 1, zahlung: "bar", einlassen: true, garderobe: 1 });
  pruefe(mitT?.ok && mitT.gesamtCent === 2700 && mitT.eingelassen, "Ticket + Garderobe bar: 27 €, eingelassen", mitT?.gesamtCent);
  pruefe((await drin()) === drinG + 1, "… drin +1 (nur das Ticket)");

  const ppG = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: "", menge: 0, zahlung: "paypal", einlassen: true, garderobe: 1 });
  pruefe(ppG?.ok && ppG.direkt?.link?.endsWith("/2.00EUR"), "Nur Garderobe per PayPal: Link über 2 €", ppG?.direkt?.link);
  const ppGok = await schicken(kasse, { schritt: "bestaetigen", bestellungId: ppG.bestellungId, einlassen: true });
  pruefe(ppGok?.ok && ppGok.eingelassen === 0, "… Zahlung gesehen, niemand eingelassen", ppGok);

  const { count: markenNachher } = await dienst.from("garderobe_marken").select("*", { count: "exact", head: true }).eq("event_id", ev.id);
  pruefe(markenNachher === markenVorher, "Keine digitalen Marken entstanden (körperliches Zeichen)", { markenVorher, markenNachher });

  const leer = await schicken(kasse, { schritt: "verkaufen", eventId: ev.id, phaseId: "", menge: 0, zahlung: "bar", einlassen: true, garderobe: 0 });
  pruefe(leer?.ok === false, "Weder Ticket noch Garderobe: abgelehnt", leer?.fehler);

  const stG = (await holen(kasse, ev.id)).daten?.stand;
  pruefe(stG?.garderobe === 4, "Kassenstand: 4 Garderobe", stG?.garderobe);
  pruefe(stG?.barCent === 7500 + 400 + 2700 && stG?.paypalDirektCent === 2500 + 200, "… Geld steckt in Bar und PayPal", stG);

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
