/**
 * Prüft den Einlass mit einer echten Anmeldung.
 *
 *   node scripts/einlass-testen.mjs
 *
 * Der Scanner selbst braucht eine Kamera und muss auf dem Gerät geprüft
 * werden. Was hier läuft, ist der Teil darunter: Greift die
 * Mitarbeiterrolle? Lässt sich ein Ticket genau einmal entwerten? Was
 * passiert bei einem fremden Code?
 *
 * Dafür wird eine echte Sitzung erzeugt (Anmeldelink einlösen), weil
 * entwerte_ticket auf auth.uid() schaut — mit dem Dienstschlüssel wäre
 * die Prüfung wertlos.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TEST_EMAIL = "einlasstest@lunar-events.de";

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
}

/** Meldet eine Adresse an, ohne dass eine Mail verschickt werden muss. */
async function sitzungFuer(email) {
  const { data, error } = await dienst.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  const frisch = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: sitzung, error: fehler } = await frisch.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: "email",
  });
  if (fehler) throw fehler;
  return { client: frisch, user: sitzung.user };
}

async function aufraeumen() {
  const { data: kunde } = await dienst
    .from("kunden").select("id").eq("email", TEST_EMAIL).maybeSingle();
  if (kunde) {
    const { data: bestellungen } = await dienst
      .from("bestellungen").select("id").eq("kunde_id", kunde.id);
    const ids = (bestellungen ?? []).map((b) => b.id);
    if (ids.length) {
      const { data: positionen } = await dienst
        .from("bestellpositionen").select("phase_id, menge").in("bestellung_id", ids);
      for (const pos of positionen ?? []) {
        const { data: phase } = await dienst
          .from("phasen").select("verkauft").eq("id", pos.phase_id).single();
        if (phase) {
          await dienst.from("phasen")
            .update({ verkauft: Math.max(0, phase.verkauft - pos.menge) })
            .eq("id", pos.phase_id);
        }
      }
      await dienst.from("tickets").delete().in("bestellung_id", ids);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", ids);
      await dienst.from("bestellungen").delete().in("id", ids);
    }
    await dienst.from("kunden").delete().eq("id", kunde.id);
  }

  const { data: konten } = await dienst.auth.admin.listUsers();
  const konto = konten.users.find((u) => u.email === TEST_EMAIL);
  if (konto) {
    await dienst.from("mitarbeiter").delete().eq("user_id", konto.id);
    await dienst.auth.admin.deleteUser(konto.id);
  }
}

async function durchspielen() {
  // --- Ein bezahltes Ticket herstellen ---
  const { data: event } = await dienst
    .from("events")
    .select("id, titel, phasen(id, art, aktiv, kontingent, verkauft)")
    .eq("status", "veroeffentlicht")
    .gt("beginn", new Date().toISOString())
    .limit(1).single();

  const phase = event.phasen.find(
    (p) => p.art === "standard" && p.aktiv &&
           (p.kontingent === null || p.verkauft < p.kontingent),
  );

  const { data: bestellungId } = await dienst.rpc("reserviere", {
    p_event_id: event.id,
    p_auswahl: [{ phase_id: phase.id, menge: 1 }],
    p_email: TEST_EMAIL,
    p_vorname: "Einlass",
    p_nachname: "Test",
  });
  await dienst.rpc("bestaetige_zahlung", {
    p_bestellung_id: bestellungId,
    p_zahlungsart: "frei",
    p_referenz: "einlasstest",
  });
  const { data: tickets } = await dienst
    .from("tickets").select("code").eq("bestellung_id", bestellungId);
  const code = tickets[0].code;
  console.log(`\nTicket für ${event.titel}: ${code}\n`);

  // --- 1. Angemeldet, aber kein Personal ---
  const gast = await sitzungFuer(TEST_EMAIL);
  const { data: ohneRolle } = await gast.client.rpc("entwerte_ticket", { p_code: code });
  pruefe(ohneRolle.ergebnis === "keine_berechtigung",
         "Gast darf nicht entwerten", ohneRolle.ergebnis);

  const { data: fremdeTickets } = await gast.client
    .from("tickets").select("code").neq("bestellung_id", bestellungId);
  pruefe((fremdeTickets ?? []).length === 0,
         "Gast sieht keine fremden Tickets", `${(fremdeTickets ?? []).length} sichtbar`);

  // --- 2. Mit Einlassrolle ---
  await dienst.from("mitarbeiter").upsert(
    { user_id: gast.user.id, name: "Einlass Test", rolle: "einlass", aktiv: true },
    { onConflict: "user_id" },
  );

  const personal = await sitzungFuer(TEST_EMAIL);
  const { data: ersterScan } = await personal.client.rpc("entwerte_ticket", { p_code: code });
  pruefe(ersterScan.ergebnis === "gueltig", "Erster Scan lässt rein", ersterScan.ergebnis);
  pruefe(ersterScan.event === event.titel, "Event wird mitgeliefert", ersterScan.event ?? "");

  const { data: zweiterScan } = await personal.client.rpc("entwerte_ticket", { p_code: code });
  pruefe(zweiterScan.ergebnis === "schon_entwertet",
         "Zweiter Scan wird abgewiesen", zweiterScan.ergebnis);
  pruefe(Boolean(zweiterScan.zeitpunkt), "Zeitpunkt der Entwertung wird genannt");

  const { data: fremd } = await personal.client
    .rpc("entwerte_ticket", { p_code: "XXXXXXXXXXXXXXXXXXXX" });
  pruefe(fremd.ergebnis === "unbekannt", "Fremder Code fällt durch", fremd.ergebnis);

  // --- 3. Rolle entzogen ---
  await dienst.from("mitarbeiter").update({ aktiv: false }).eq("user_id", gast.user.id);
  const { data: entzogen } = await personal.client.rpc("entwerte_ticket", { p_code: code });
  pruefe(entzogen.ergebnis === "keine_berechtigung",
         "Entzogene Rolle wirkt sofort, ohne neue Anmeldung", entzogen.ergebnis);

  const { data: ticketDanach } = await dienst
    .from("tickets").select("status, entwertet_am, entwertet_von").eq("code", code).single();
  pruefe(ticketDanach.status === "entwertet", "Ticket ist entwertet");
  pruefe(ticketDanach.entwertet_von === gast.user.id, "Es steht fest, wer gescannt hat");
}

try {
  if (process.argv.includes("--weg")) {
    await aufraeumen();
    console.log("Aufgeräumt.");
  } else {
    await aufraeumen();
    await durchspielen();
    await aufraeumen();
    console.log("\nAufgeräumt.");
  }
} catch (fehler) {
  console.error("\nAbgebrochen:", fehler.message ?? fehler);
  await aufraeumen().catch(() => {});
  process.exit(1);
}
