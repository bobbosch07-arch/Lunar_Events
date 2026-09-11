/**
 * Spielt einen echten Stripe-Kauf durch, ohne Browser.
 *
 *   node scripts/zahlung-testen.mjs
 *
 * Warum das nötig ist: Das Zahlungsformular läuft in einem Stripe-iframe,
 * in das sich von außen keine Testkarte tippen lässt. Der iframe ist
 * Stripes Code und muss nicht geprüft werden — unsere Seite schon:
 * Reservierung, Zahlungsvorbereitung, Bestätigung, Tickets, Kontingente.
 *
 * Läuft nur mit Testschlüsseln (sk_test_…) und legt eine echte Bestellung
 * in der Datenbank an. Mit --weg werden alle Testkäufe wieder entfernt.
 */
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const SCHLUESSEL = process.env.STRIPE_SECRET_KEY ?? "";
if (!SCHLUESSEL.startsWith("sk_test_")) {
  console.error("Abbruch: Das hier läuft nur mit Testschlüsseln.");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const stripe = new Stripe(SCHLUESSEL);

const TEST_EMAIL = "zahlungstest@lunar-events.de";

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function weg() {
  const { data: kunde } = await db
    .from("kunden").select("id").eq("email", TEST_EMAIL).maybeSingle();
  if (!kunde) return console.log("Nichts aufzuräumen.");

  const { data: bestellungen } = await db
    .from("bestellungen").select("id").eq("kunde_id", kunde.id);
  const ids = (bestellungen ?? []).map((b) => b.id);

  if (ids.length > 0) {
    // Verkaufte Kontingente zurückgeben, sonst bleibt die Testwelt verzerrt.
    const { data: positionen } = await db
      .from("bestellpositionen").select("phase_id, menge").in("bestellung_id", ids);
    for (const pos of positionen ?? []) {
      const { data: phase } = await db
        .from("phasen").select("verkauft").eq("id", pos.phase_id).single();
      if (phase) {
        await db.from("phasen")
          .update({ verkauft: Math.max(0, phase.verkauft - pos.menge) })
          .eq("id", pos.phase_id);
      }
    }
    await db.from("tickets").delete().in("bestellung_id", ids);
    await db.from("bestellpositionen").delete().in("bestellung_id", ids);
    await db.from("bestellungen").delete().in("id", ids);
  }
  await db.from("kunden").delete().eq("id", kunde.id);
  console.log(`Entfernt: ${ids.length} Testbestellungen, Kontingente zurückgegeben.`);
}

async function durchspielen() {
  // --- Vorbereitung: ein Event mit kaufbarer Phase suchen ---
  const { data: event } = await db
    .from("events")
    .select("id, titel, slug, phasen(id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, aktiv)")
    .eq("status", "veroeffentlicht")
    .gt("beginn", new Date().toISOString())
    .limit(1)
    .single();

  if (!event) {
    console.error("Kein kaufbares Event. Erst: node scripts/testdaten.mjs");
    process.exit(1);
  }

  const phase = event.phasen.find(
    (p) => p.art === "standard" && p.aktiv &&
           (p.kontingent === null || p.verkauft < p.kontingent),
  );
  if (!phase) {
    console.error("Keine kaufbare Phase gefunden.");
    process.exit(1);
  }

  console.log(`\nEvent: ${event.titel} · Phase: ${phase.name}`);
  const verkauftVorher = phase.verkauft;
  const erwartet = (phase.preis_cent + phase.gebuehr_cent) * 2;

  // --- 1. Reservierung ---
  const { data: bestellungId, error: resFehler } = await db.rpc("reserviere", {
    p_event_id: event.id,
    p_auswahl: [{ phase_id: phase.id, menge: 2 }],
    p_email: TEST_EMAIL,
    p_vorname: "Zahlungs",
    p_nachname: "Test",
  });
  if (resFehler) {
    console.error("Reservierung fehlgeschlagen:", resFehler.message);
    process.exit(1);
  }

  const { data: b1 } = await db
    .from("bestellungen").select("nummer, status, gesamt_cent, reserviert_bis")
    .eq("id", bestellungId).single();

  pruefe(b1.status === "offen", "Bestellung ist reserviert", b1.nummer);
  pruefe(b1.gesamt_cent === erwartet, "Betrag stimmt",
         `${b1.gesamt_cent} Cent (erwartet ${erwartet})`);
  pruefe(Boolean(b1.reserviert_bis), "Reservierungsfrist gesetzt");

  const { data: phaseNachRes } = await db
    .from("phasen").select("verkauft").eq("id", phase.id).single();
  pruefe(phaseNachRes.verkauft === verkauftVorher + 2,
         "Kontingent sofort gehalten", `${verkauftVorher} → ${phaseNachRes.verkauft}`);

  // --- 2. Zahlung vorbereiten ---
  const absicht = await stripe.paymentIntents.create({
    amount: b1.gesamt_cent,
    currency: "eur",
    payment_method_types: ["card"],
    metadata: { bestellung_id: bestellungId, nummer: b1.nummer },
  });
  await db.from("bestellungen")
    .update({ zahlung_ref: absicht.id, zahlungsart: "stripe" })
    .eq("id", bestellungId);
  pruefe(absicht.amount === erwartet, "Stripe kennt den richtigen Betrag");

  // --- 3. Zahlen mit Testkarte ---
  const bezahlt = await stripe.paymentIntents.confirm(absicht.id, {
    payment_method: "pm_card_visa",
    return_url: "https://lunar-events.vercel.app/checkout/bestaetigung",
  });
  pruefe(bezahlt.status === "succeeded", "Zahlung durchgegangen", bezahlt.status);

  // --- 4. Bestätigen (das macht sonst der Webhook) ---
  const { error: bestFehler } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "stripe",
    p_referenz: bezahlt.id,
  });
  pruefe(!bestFehler, "Bestätigung angenommen", bestFehler?.message ?? "");

  const { data: b2 } = await db
    .from("bestellungen").select("status, bezahlt_am, reserviert_bis, zahlung_ref")
    .eq("id", bestellungId).single();
  pruefe(b2.status === "bezahlt", "Bestellung ist bezahlt");
  pruefe(b2.reserviert_bis === null, "Reservierungsfrist aufgehoben");
  pruefe(b2.zahlung_ref === bezahlt.id, "Zahlung ist zugeordnet");

  const { data: tickets } = await db
    .from("tickets").select("code, status").eq("bestellung_id", bestellungId);
  pruefe(tickets.length === 2, "Zwei Tickets entstanden", `${tickets.length}`);
  pruefe(tickets.every((t) => t.status === "gueltig"), "Tickets sind gültig");
  pruefe(new Set(tickets.map((t) => t.code)).size === tickets.length,
         "Codes sind verschieden");
  pruefe(tickets.every((t) => t.code.length === 20), "Codes haben volle Länge");

  // --- 5. Doppelte Meldung: Stripe wiederholt gern ---
  const { error: zweitFehler } = await db.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "stripe",
    p_referenz: bezahlt.id,
  });
  const { data: ticketsDanach } = await db
    .from("tickets").select("id").eq("bestellung_id", bestellungId);
  pruefe(!zweitFehler && ticketsDanach.length === 2,
         "Zweite Meldung erzeugt keine zweiten Tickets",
         `${ticketsDanach.length} Tickets`);

  // --- 6. Entwerten ---
  const { data: einlass } = await db.rpc("entwerte_ticket", { p_code: tickets[0].code });
  pruefe(einlass.ergebnis === "keine_berechtigung",
         "Ohne Mitarbeiterrolle kein Entwerten", einlass.ergebnis);

  const { data: unbekannt } = await db.rpc("entwerte_ticket", { p_code: "GIBTESNICHT12345678" });
  pruefe(unbekannt.ergebnis === "keine_berechtigung",
         "Unbekannter Code wirft keine Ausnahme", unbekannt.ergebnis);

  console.log(`\nBestellung ${b1.nummer} liegt in der Datenbank.`);
  console.log("Aufräumen: node scripts/zahlung-testen.mjs --weg");
}

try {
  await (process.argv.includes("--weg") ? weg() : durchspielen());
} catch (fehler) {
  console.error("\nAbgebrochen:", fehler.message ?? fehler);
  process.exit(1);
}
