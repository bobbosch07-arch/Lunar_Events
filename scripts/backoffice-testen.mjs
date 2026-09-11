/**
 * Prüft, was das Backoffice sehen darf — mit echten Anmeldungen.
 *
 *   node scripts/backoffice-testen.mjs
 *
 * Die Seiten selbst antworten immer mit 200, auch wenn sie nur "kein
 * Zugang" zeigen. Interessant ist die Ebene darunter: Lassen die
 * Zugriffsregeln ein Team-Konto an Bestellungen und VIP-Anfragen, und
 * halten sie ein fremdes Konto davon fern?
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OEFFENTLICH = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TEAM = "teamtest@lunar-events.de";
const FREMD = "fremdtest@lunar-events.de";

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
}

async function sitzungFuer(email) {
  const { data, error } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: s, error: f } = await client.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: "email",
  });
  if (f) throw f;
  return { client, user: s.user };
}

async function aufraeumen() {
  const { data: konten } = await dienst.auth.admin.listUsers();
  for (const email of [TEAM, FREMD]) {
    const konto = konten.users.find((u) => u.email === email);
    if (!konto) continue;
    await dienst.from("mitarbeiter").delete().eq("user_id", konto.id);
    await dienst.from("kunden").delete().eq("user_id", konto.id);
    await dienst.auth.admin.deleteUser(konto.id);
  }
  await dienst.from("vip_anfragen").delete().eq("email", "anfragetest@lunar-events.de");
}

async function durchspielen() {
  // Eine VIP-Anfrage, die im Backoffice auftauchen muss
  await dienst.from("vip_anfragen").insert({
    name: "Testanfrage",
    email: "anfragetest@lunar-events.de",
    gaeste: 8,
    status: "neu",
  });

  const team = await sitzungFuer(TEAM);
  const fremd = await sitzungFuer(FREMD);

  // --- Fremdes Konto: darf nichts sehen ---
  const { data: fremdBestellungen } = await fremd.client.from("bestellungen").select("id");
  pruefe((fremdBestellungen ?? []).length === 0,
         "Fremdes Konto sieht keine Bestellungen", `${(fremdBestellungen ?? []).length}`);

  const { data: fremdVip } = await fremd.client.from("vip_anfragen").select("id");
  pruefe((fremdVip ?? []).length === 0,
         "Fremdes Konto sieht keine VIP-Anfragen", `${(fremdVip ?? []).length}`);

  const { data: fremdEntwuerfe } = await fremd.client
    .from("events").select("id").eq("status", "entwurf");
  pruefe((fremdEntwuerfe ?? []).length === 0,
         "Fremdes Konto sieht keine Entwürfe", `${(fremdEntwuerfe ?? []).length}`);

  const { error: fremdSchreibt } = await fremd.client
    .from("events").update({ titel: "Gekapert" }).eq("slug", "test-eclipse");
  const { data: unveraendert } = await dienst
    .from("events").select("titel").eq("slug", "test-eclipse").maybeSingle();
  pruefe(unveraendert?.titel !== "Gekapert",
         "Fremdes Konto kann kein Event ändern",
         fremdSchreibt ? "abgewiesen" : "stillschweigend ignoriert");

  // --- Team-Konto ---
  await dienst.from("mitarbeiter").upsert(
    { user_id: team.user.id, name: "Team Test", rolle: "team", aktiv: true },
    { onConflict: "user_id" },
  );
  const teamNeu = await sitzungFuer(TEAM);

  const { data: teamVip } = await teamNeu.client.from("vip_anfragen").select("id, name");
  pruefe((teamVip ?? []).length > 0, "Team sieht VIP-Anfragen", `${(teamVip ?? []).length}`);

  const { data: teamBestellungen } = await teamNeu.client
    .from("bestellungen").select("id, nummer");
  pruefe(Array.isArray(teamBestellungen), "Team kann Bestellungen lesen",
         `${(teamBestellungen ?? []).length}`);

  const { error: teamSchreibt } = await teamNeu.client
    .from("vip_anfragen").update({ status: "in_bearbeitung" }).eq("email", "anfragetest@lunar-events.de");
  pruefe(!teamSchreibt, "Team kann den Anfragestatus setzen", teamSchreibt?.message ?? "");

  // --- Ein Event anlegen, wie es das Formular täte ---
  const { data: ort } = await teamNeu.client.from("orte").select("id").limit(1).single();
  const { data: neu, error: anlegeFehler } = await teamNeu.client
    .from("events")
    .insert({
      slug: "test-backoffice-probe",
      titel: "Backoffice Probe",
      kategorie: "club",
      status: "entwurf",
      beginn: new Date(Date.now() + 86400000 * 20).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
      abendkasse: false,
      featured: false,
    })
    .select("id, slug")
    .single();
  pruefe(!anlegeFehler && Boolean(neu), "Team kann ein Event anlegen",
         anlegeFehler?.message ?? "");

  if (neu) {
    const { error: phasenFehler } = await teamNeu.client.from("phasen").insert({
      event_id: neu.id, name: "Standard", art: "standard",
      preis_cent: 3900, gebuehr_cent: 250, kontingent: 100, verkauft: 0,
      leistungen: ["Eintritt"], position: 1, aktiv: true,
    });
    pruefe(!phasenFehler, "Team kann Phasen anlegen", phasenFehler?.message ?? "");

    // Ein Entwurf darf oeffentlich nicht sichtbar sein
    const anonym = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
    const { data: oeffentlich } = await anonym
      .from("events").select("id").eq("slug", "test-backoffice-probe");
    pruefe((oeffentlich ?? []).length === 0,
           "Entwurf bleibt öffentlich unsichtbar", `${(oeffentlich ?? []).length} sichtbar`);

    await dienst.from("phasen").delete().eq("event_id", neu.id);
    await dienst.from("events").delete().eq("id", neu.id);
  }
}

try {
  await aufraeumen();
  await durchspielen();
  await aufraeumen();
  console.log("\nAufgeräumt.");
} catch (fehler) {
  console.error("\nAbgebrochen:", fehler.message ?? fehler);
  await aufraeumen().catch(() => {});
  process.exit(1);
}
