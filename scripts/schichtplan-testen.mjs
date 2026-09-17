/**
 * Prüft den Schichtplan mit echten Anmeldungen.
 *
 *   node scripts/schichtplan-testen.mjs
 *
 * Legt ein Test-Event als Entwurf und drei Konten an (Admin, Bar, Security),
 * teilt ein, checkt ein und aus und prüft, wer was sehen und ändern darf.
 * Räumt am Ende alles weg, auch wenn unterwegs etwas schiefgeht.
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
const angelegt = { event: null, nutzer: [] };
const stunde = 3600000;

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function personal(rolle) {
  const email = `schichttest-${rolle}-${K}@lunar-events.de`;
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${rolle}: ${error.message}`);
  angelegt.nutzer.push(neu.user.id);
  const { error: mf } = await dienst
    .from("mitarbeiter")
    .insert({ user_id: neu.user.id, name: `Schichttest ${rolle}`, rolle, aktiv: true });
  if (mf) throw new Error(`Mitarbeiter ${rolle}: ${mf.message}`);

  const { data: link, error: lf } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (lf) throw new Error(`Link ${rolle}: ${lf.message}`);
  const client = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: vf } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (vf) throw new Error(`Anmeldung ${rolle}: ${vf.message}`);
  return { id: neu.user.id, client };
}

async function durchspielen() {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const beginn = new Date(Date.now() + 7 * 24 * stunde);
  const { data: ev, error } = await dienst
    .from("events")
    .insert({
      slug: `test-schicht-${K}`,
      titel: "TEST SCHICHTPLAN",
      kategorie: "club",
      status: "entwurf",
      beginn: beginn.toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.event = ev.id;

  const admin = await personal("admin");
  await richteZweitenFaktorEin(admin.client, "Schichttest");
  const bar = await personal("bar");
  const security = await personal("security");

  const von = new Date(beginn.getTime() - stunde);
  const bis = new Date(beginn.getTime() + 5 * stunde);
  const schicht = {
    event_id: ev.id,
    user_id: bar.id,
    rolle: "bar",
    station: "Bar 2",
    beginn: von.toISOString(),
    ende: bis.toISOString(),
    pause_min: 30,
    notiz: "Schlüssel bei Niklas",
  };

  console.log("\n— Einteilen —");
  const { data: angelegteSchicht, error: af } = await admin.client
    .from("schichten")
    .insert(schicht)
    .select("id")
    .single();
  pruefe(!af && Boolean(angelegteSchicht), "Admin teilt ein", af?.message ?? "");

  const { error: barSchreibt } = await bar.client.from("schichten").insert({
    ...schicht,
    user_id: security.id,
    beginn: new Date(von.getTime() + stunde).toISOString(),
  });
  pruefe(Boolean(barSchreibt), "Bar darf niemanden einteilen", barSchreibt ? "abgewiesen" : "durchgelassen");

  const { error: doppelt } = await admin.client.from("schichten").insert(schicht);
  pruefe(Boolean(doppelt), "Dieselbe Person nicht zweimal zur selben Zeit");

  const { error: verdreht } = await admin.client
    .from("schichten")
    .insert({ ...schicht, user_id: security.id, beginn: bis.toISOString(), ende: von.toISOString() });
  pruefe(Boolean(verdreht), "Ende vor Beginn wird abgelehnt");

  const { error: langePause } = await admin.client
    .from("schichten")
    .insert({ ...schicht, user_id: security.id, pause_min: 599 });
  pruefe(Boolean(langePause), "Pause länger als die Schicht wird abgelehnt");

  console.log("\n— Wer sieht was —");
  const { data: barSieht } = await bar.client.from("schichten").select("id, station");
  const { data: securitySieht } = await security.client.from("schichten").select("id");
  const { data: adminSieht } = await admin.client.from("schichten").select("id").eq("event_id", ev.id);
  pruefe((barSieht ?? []).some((s) => s.id === angelegteSchicht.id), "Bar sieht die eigene Schicht");
  pruefe(!(securitySieht ?? []).some((s) => s.id === angelegteSchicht.id),
    "Security sieht fremde Schichten nicht", `${(securitySieht ?? []).length} sichtbar`);
  pruefe((adminSieht ?? []).length === 1, "Admin sieht den ganzen Plan");

  const { error: barAendert } = await bar.client
    .from("schichten")
    .update({ station: "Bar 1" })
    .eq("id", angelegteSchicht.id);
  const { data: danach } = await dienst
    .from("schichten")
    .select("station")
    .eq("id", angelegteSchicht.id)
    .single();
  pruefe(danach.station === "Bar 2", "Bar kann die eigene Schicht nicht umschreiben",
    barAendert ? "abgewiesen" : "stillschweigend ignoriert");

  console.log("\n— Stunden —");
  // schicht_stunden() prüft die Migration selbst (Zeilentyp, über die
  // Schnittstelle nicht aufrufbar). Hier zählt dieselbe Rechnung, wie die
  // Anwendung sie macht: 6 Stunden minus 30 Minuten Pause.
  const stundenAus = (s) => {
    const gemessen = Boolean(s.eingecheckt_am && s.ausgecheckt_am);
    const von = new Date(gemessen ? s.eingecheckt_am : s.beginn);
    const bis = new Date(gemessen ? s.ausgecheckt_am : s.ende);
    return Math.max(0, Math.round(((bis - von) / 3600000 - s.pause_min / 60) * 100) / 100);
  };
  pruefe(stundenAus(schicht) === 5.5, "Geplant: 6 Stunden minus Pause = 5,5", String(stundenAus(schicht)));

  const ein = new Date(von.getTime() + 30 * 60000).toISOString();
  await admin.client
    .from("schichten")
    .update({ eingecheckt_am: ein })
    .eq("id", angelegteSchicht.id);
  const { error: barChecktAus } = await bar.client
    .from("schichten")
    .update({ ausgecheckt_am: new Date().toISOString() })
    .eq("id", angelegteSchicht.id);
  const { data: nachBar } = await dienst
    .from("schichten")
    .select("ausgecheckt_am")
    .eq("id", angelegteSchicht.id)
    .single();
  pruefe(nachBar.ausgecheckt_am === null, "Auschecken macht der Admin, nicht die Person",
    barChecktAus ? "abgewiesen" : "stillschweigend ignoriert");

  await admin.client
    .from("schichten")
    .update({ ausgecheckt_am: bis.toISOString() })
    .eq("id", angelegteSchicht.id);
  const { data: fertig } = await dienst
    .from("schichten")
    .select("beginn, ende, pause_min, eingecheckt_am, ausgecheckt_am")
    .eq("id", angelegteSchicht.id)
    .single();
  pruefe(stundenAus(fertig) === 5, "Eine halbe Stunde später gekommen: 5,0 Stunden",
    String(stundenAus(fertig)));

  const { error: ohneEin } = await admin.client
    .from("schichten")
    .update({ eingecheckt_am: null })
    .eq("id", angelegteSchicht.id);
  pruefe(Boolean(ohneEin), "Ausgecheckt ohne eingecheckt wird abgelehnt");

  console.log("\n— Öffentlichkeit —");
  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { data: anonSieht } = await anon.from("schichten").select("id");
  pruefe((anonSieht ?? []).length === 0, "Ohne Anmeldung ist der Plan unsichtbar");
}

async function aufraeumen() {
  if (angelegt.event) {
    await dienst.from("schichten").delete().eq("event_id", angelegt.event);
    await dienst.from("events").delete().eq("id", angelegt.event);
  }
  for (const id of angelegt.nutzer) {
    await dienst.from("schichten").delete().eq("user_id", id);
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  const { count } = await dienst
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("slug", `test-schicht-${K}`);
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("schichttest-")).length;
  const sauber = count === 0 && rest === 0;
  console.log(`\nAufgeräumt: ${sauber ? "Event, Schichten und Testkonten weg" : `NOCH DA: ${count}/${rest}`}`);
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
