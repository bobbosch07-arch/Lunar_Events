/**
 * Legt eine Testwelt an: drei Orte, vier Events mit Ticketphasen, die
 * jeden Sonderfall abdecken — ausverkaufte Phase, knappes Kontingent,
 * unbegrenzte Phase, VIP auf Anfrage, ein ausverkauftes Event, eines
 * ohne Abendkasse.
 *
 *   node scripts/testdaten.mjs          # anlegen
 *   node scripts/testdaten.mjs --weg    # wieder entfernen
 *
 * Braucht SUPABASE_SERVICE_ROLE_KEY in .env.local. Alle Datensaetze
 * tragen einen Slug mit Praefix "test-", damit --weg nichts anderes
 * erwischt.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Zeilen werden getrimmt, bevor das Muster greift: unter Windows endet
// jede mit \r, und "." matcht in JavaScript kein \r — das Muster liefe
// sonst still ins Leere.
for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const treffer = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (treffer) process.env[treffer[1]] ??= treffer[2].trim();
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PRAEFIX = "test-";

function inTagen(tage, stunde = 23, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  d.setHours(stunde, minute, 0, 0);
  return d.toISOString();
}

const ORTE = [
  { name: "Alte Werft", stadt: "Darmstadt", strasse: "Rheinstraße 1", plz: "64283" },
  { name: "Rooftop 12", stadt: "Darmstadt", strasse: "Luisenstraße 12", plz: "64289" },
  { name: "Halle Nord", stadt: "Darmstadt", strasse: "Frankfurter Straße 34", plz: "64293" },
];

const EVENTS = [
  {
    slug: PRAEFIX + "lunar-night-03",
    titel: "LUNAR NIGHT 03",
    untertitel: "Die dritte Nacht",
    teaser: "Drei Floors, ein Innenhof, Einlass bis zwei.",
    beschreibung:
      "Die dritte Ausgabe unserer Hausreihe. Zwei Floors im Hauptsaal, House und Afro im Innenhof, dazu eine Bar, die bis fünf offen bleibt.\n\nDer Innenhof ist überdacht und beheizt.",
    kategorie: "club",
    beginn: inTagen(18),
    einlass: inTagen(18, 22, 0),
    ende: inTagen(19, 5, 0),
    ort: 0,
    mindestalter: 21,
    dresscode: "Elegant. Keine Sportkleidung, keine Caps.",
    abendkasse: true,
    featured: true,
    phasen: [
      { name: "Early Bird", preis_cent: 2900, gebuehr_cent: 200, kontingent: 120, verkauft: 120, position: 1, leistungen: ["Eintritt", "Garderobe inklusive"] },
      { name: "Phase 2", preis_cent: 3900, gebuehr_cent: 250, kontingent: 200, verkauft: 176, position: 2, leistungen: ["Eintritt", "Garderobe inklusive"] },
      { name: "Standard", preis_cent: 4900, gebuehr_cent: 250, kontingent: null, verkauft: 41, position: 3, leistungen: ["Eintritt", "Garderobe inklusive"] },
      {
        name: "VIP Experience", art: "vip", preis_cent: 0, gebuehr_cent: 0,
        kontingent: 8, verkauft: 3, position: 4,
        beschreibung: "Für vier bis zwölf Gäste. Wir melden uns innerhalb von 24 Stunden.",
        leistungen: [
          "Eigener Tisch mit reservierter Fläche",
          "Bottle Service am Platz",
          "Priority Entry ohne Anstehen",
          "Persönliche Absprache vorab",
        ],
      },
    ],
  },
  {
    slug: PRAEFIX + "moonrise-rooftop-opening",
    titel: "MOONRISE",
    untertitel: "Rooftop Opening",
    teaser: "Sonnenuntergang über Darmstadt, danach die ganze Nacht.",
    beschreibung:
      "Wir eröffnen die Dachterrasse. Ab 20 Uhr Apéro mit Blick über die Stadt, ab Mitternacht drinnen weiter.",
    kategorie: "rooftop",
    beginn: inTagen(32, 20, 0),
    einlass: inTagen(32, 19, 30),
    ende: inTagen(33, 4, 0),
    ort: 1,
    mindestalter: 21,
    dresscode: "Smart casual.",
    abendkasse: false,
    featured: true,
    phasen: [
      { name: "Sunset", preis_cent: 3500, gebuehr_cent: 250, kontingent: 80, verkauft: 62, position: 1, leistungen: ["Eintritt ab 20:00", "Welcome Drink"] },
      { name: "Standard", preis_cent: 4500, gebuehr_cent: 250, kontingent: 150, verkauft: 88, position: 2, leistungen: ["Eintritt ab 22:00"] },
      {
        name: "VIP Experience", art: "vip", preis_cent: 0, gebuehr_cent: 0,
        kontingent: 5, verkauft: 1, position: 3,
        beschreibung: "Tische auf der oberen Terrasse, für sechs bis zehn Gäste.",
        leistungen: ["Tisch auf der oberen Terrasse", "Bottle Service", "Priority Entry"],
      },
    ],
  },
  {
    slug: PRAEFIX + "eclipse",
    titel: "ECLIPSE",
    teaser: "Eine Halle, ein Line-up, kein Licht zu viel.",
    beschreibung: "Halle Nord, komplett abgedunkelt. Line-up wird zwei Wochen vorher bekanntgegeben.",
    kategorie: "party",
    beginn: inTagen(46),
    einlass: inTagen(46, 22, 30),
    ort: 2,
    mindestalter: 18,
    abendkasse: true,
    abendkasse_hinweis: "Nur solange Plätze frei sind.",
    featured: false,
    phasen: [
      { name: "Early Bird", preis_cent: 2500, gebuehr_cent: 200, kontingent: 200, verkauft: 24, position: 1, leistungen: ["Eintritt"] },
      { name: "Standard", preis_cent: 3500, gebuehr_cent: 200, kontingent: null, verkauft: 0, position: 2, leistungen: ["Eintritt"] },
    ],
  },
  {
    slug: PRAEFIX + "lunar-night-02",
    titel: "LUNAR NIGHT 02",
    teaser: "Ausverkauft — die zweite Nacht.",
    beschreibung: "Ausverkauft. Wer kein Ticket hat, kommt nicht rein — auch nicht an der Tür.",
    kategorie: "club",
    beginn: inTagen(60),
    ort: 0,
    mindestalter: 21,
    dresscode: "Elegant.",
    abendkasse: false,
    featured: false,
    phasen: [
      { name: "Early Bird", preis_cent: 2900, gebuehr_cent: 200, kontingent: 150, verkauft: 150, position: 1, leistungen: ["Eintritt"] },
      { name: "Standard", preis_cent: 3900, gebuehr_cent: 250, kontingent: 250, verkauft: 250, position: 2, leistungen: ["Eintritt"] },
    ],
  },
];

async function weg() {
  const { data: events } = await db.from("events").select("id, slug").like("slug", `${PRAEFIX}%`);
  const ids = (events ?? []).map((e) => e.id);
  if (ids.length > 0) {
    // Reihenfolge zaehlt: events haengt an bestellungen mit "on delete
    // restrict". Wer zuerst das Event loeschen will, kommt nach dem ersten
    // Testkauf nicht mehr weiter.
    const { data: bestellungen } = await db
      .from("bestellungen").select("id, kunde_id").in("event_id", ids);
    const bIds = (bestellungen ?? []).map((b) => b.id);

    if (bIds.length > 0) {
      await db.from("tickets").delete().in("bestellung_id", bIds);
      await db.from("bestellpositionen").delete().in("bestellung_id", bIds);
      await db.from("bestellungen").delete().in("id", bIds);

      // Kunden nur entfernen, wenn keine andere Bestellung mehr an ihnen haengt.
      for (const kundeId of new Set((bestellungen ?? []).map((b) => b.kunde_id))) {
        const { count } = await db
          .from("bestellungen").select("id", { count: "exact", head: true })
          .eq("kunde_id", kundeId);
        if (!count) await db.from("kunden").delete().eq("id", kundeId);
      }
    }

    await db.from("vip_anfragen").delete().in("event_id", ids);
    await db.from("phasen").delete().in("event_id", ids);
    await db.from("events").delete().in("id", ids);
    console.log(`Dabei entfernt: ${bIds.length} Bestellungen samt Tickets.`);
  }
  // Orte nur loeschen, wenn kein Event mehr daran haengt.
  for (const o of ORTE) {
    const { data: ort } = await db
      .from("orte").select("id").eq("name", o.name).eq("stadt", o.stadt).maybeSingle();
    if (!ort) continue;
    const { count } = await db
      .from("events").select("id", { count: "exact", head: true }).eq("ort_id", ort.id);
    if (!count) await db.from("orte").delete().eq("id", ort.id);
  }
  console.log(`Entfernt: ${ids.length} Events samt Phasen.`);
}

async function anlegen() {
  const ortIds = [];
  for (const o of ORTE) {
    const { data: vorhanden } = await db
      .from("orte").select("id").eq("name", o.name).eq("stadt", o.stadt).maybeSingle();
    if (vorhanden) {
      ortIds.push(vorhanden.id);
      continue;
    }
    const { data, error } = await db.from("orte").insert(o).select("id").single();
    if (error) throw error;
    ortIds.push(data.id);
  }

  for (const e of EVENTS) {
    const { phasen, ort, ...rest } = e;
    // Alle Pflichtspalten ausdruecklich setzen: bei einem Insert mit
    // mehreren Zeilen bildet PostgREST die Vereinigung aller Schluessel
    // und schickt fehlende als null — die Spalten-Voreinstellung greift
    // dann nicht mehr.
    const zeile = {
      ort_id: ortIds[ort],
      status: "veroeffentlicht",
      veranstalter: "Lunar Events",
      untertitel: null,
      einlass: null,
      ende: null,
      dresscode: null,
      abendkasse_hinweis: null,
      mindestalter: null,
      ...rest,
    };

    const { data: event, error } = await db
      .from("events").upsert(zeile, { onConflict: "slug" }).select("id").single();
    if (error) throw error;

    await db.from("phasen").delete().eq("event_id", event.id);
    const { error: pf } = await db.from("phasen").insert(
      phasen.map((p) => ({
        event_id: event.id,
        art: "standard",
        aktiv: true,
        kontingent: null,
        beschreibung: null,
        ab: null,
        bis: null,
        ...p,
      })),
    );
    if (pf) throw pf;

    console.log(`✓ ${e.titel} (${phasen.length} Phasen)`);
  }
  console.log(`\n${EVENTS.length} Events angelegt. Entfernen mit --weg.`);
}

try {
  await (process.argv.includes("--weg") ? weg() : anlegen());
} catch (fehler) {
  console.error("Fehlgeschlagen:", fehler.message ?? fehler);
  process.exit(1);
}
