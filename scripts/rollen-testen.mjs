/**
 * Prüft Rollen und den zweiten Faktor mit echten Anmeldungen.
 *
 *   node scripts/rollen-testen.mjs
 *
 * Legt je ein Konto für admin, kasse, einlass, bar und security an und
 * fragt für jedes, was `ist_mitarbeiter()` erlaubt. Danach wird die
 * Zwei-Faktor-Pflicht **kurz scharf geschaltet** (betrieb.zwei_faktor) und
 * geprüft, dass Admin und Kasse ohne Code nicht mehr durchkommen und mit
 * Code wieder. Der Schalter wird am Ende auf den vorherigen Stand
 * zurückgesetzt, auch wenn unterwegs etwas schiefgeht.
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
const ROLLEN = ["admin", "kasse", "einlass", "bar", "security"];
const angelegt = [];
let schalterVorher = null;

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function personal(rolle) {
  const email = `rollentest-${rolle}-${K}@lunar-events.de`;
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${rolle}: ${error.message}`);
  angelegt.push(neu.user.id);
  const { error: mf } = await dienst
    .from("mitarbeiter")
    .insert({ user_id: neu.user.id, name: `Rollentest ${rolle}`, rolle, aktiv: true });
  if (mf) throw new Error(`Mitarbeiter ${rolle}: ${mf.message}`);
  return { email, id: neu.user.id, client: await anmelden(email) };
}

async function anmelden(email) {
  const { data: link, error } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`Link ${email}: ${error.message}`);
  const client = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: vf } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (vf) throw new Error(`Anmeldung ${email}: ${vf.message}`);
  return client;
}

async function stufen(client) {
  const antworten = {};
  for (const stufe of ["admin", "team", "kasse", "einlass", "personal"]) {
    const { data } = await client.rpc("ist_mitarbeiter", { mindestens: stufe });
    antworten[stufe] = data === true;
  }
  return antworten;
}

async function schalter(wert) {
  const { error } = await dienst.from("betrieb").update({ wert }).eq("schluessel", "zwei_faktor");
  if (error) throw new Error(`Schalter: ${error.message}`);
}

async function durchspielen() {
  const { data: stand } = await dienst
    .from("betrieb")
    .select("wert")
    .eq("schluessel", "zwei_faktor")
    .single();
  schalterVorher = stand.wert;
  await schalter("aus");

  const konten = {};
  for (const rolle of ROLLEN) konten[rolle] = await personal(rolle);

  console.log("\n— Alte Rolle —");
  const { error: team } = await dienst
    .from("mitarbeiter")
    .update({ rolle: "team" })
    .eq("user_id", konten.security.id);
  pruefe(Boolean(team), "Die Rolle „team“ gibt es nicht mehr", team ? "abgewiesen" : "durchgelassen");

  console.log("\n— Wer darf was —");
  const erwartet = {
    admin: { admin: true, team: true, kasse: true, einlass: true, personal: true },
    kasse: { admin: false, team: false, kasse: true, einlass: true, personal: true },
    einlass: { admin: false, team: false, kasse: false, einlass: true, personal: true },
    bar: { admin: false, team: false, kasse: false, einlass: true, personal: true },
    security: { admin: false, team: false, kasse: false, einlass: false, personal: true },
  };
  for (const rolle of ROLLEN) {
    const ist = await stufen(konten[rolle].client);
    const gleich = Object.entries(erwartet[rolle]).every(([k, v]) => ist[k] === v);
    pruefe(gleich, `${rolle}: Stufen stimmen`, JSON.stringify(ist));
  }

  console.log("\n— Daten —");
  const { data: adminSieht } = await konten.admin.client.from("bestellungen").select("id").limit(5);
  const { data: kasseSieht } = await konten.kasse.client.from("bestellungen").select("id").limit(5);
  const { data: barSieht } = await konten.bar.client.from("vip_anfragen").select("id").limit(5);
  pruefe(Array.isArray(adminSieht), "Admin liest Bestellungen");
  pruefe((kasseSieht ?? []).length === 0 && (barSieht ?? []).length === 0,
    "Kasse und Bar sehen keine Bestellungen und keine VIP-Anfragen");

  const scan = async (client) =>
    (await client.rpc("entwerte_ticket", { p_code: `KEINCODE${K}`.toUpperCase() })).data?.ergebnis;
  pruefe((await scan(konten.einlass.client)) === "unbekannt", "Einlass darf scannen");
  pruefe((await scan(konten.bar.client)) === "unbekannt", "Bar darf scannen");
  pruefe((await scan(konten.kasse.client)) === "unbekannt", "Kasse darf scannen");
  pruefe((await scan(konten.security.client)) === "keine_berechtigung", "Security darf nicht scannen");

  console.log("\n— Zweiter Faktor —");
  await schalter("an");
  const adminOhne = await stufen(konten.admin.client);
  const kasseOhne = await stufen(konten.kasse.client);
  const einlassOhne = await stufen(konten.einlass.client);
  pruefe(!adminOhne.admin && !kasseOhne.kasse,
    "Mit Pflicht: Admin und Kasse kommen ohne zweiten Faktor nicht durch");
  pruefe(einlassOhne.einlass, "Einlass braucht keinen zweiten Faktor und scannt weiter");

  const { data: ohneFaktor } = await konten.admin.client.from("bestellungen").select("id").limit(1);
  pruefe((ohneFaktor ?? []).length === 0, "Ohne zweiten Faktor sieht der Admin keine Bestellungen");

  await richteZweitenFaktorEin(konten.admin.client, "Rollentest");
  await richteZweitenFaktorEin(konten.kasse.client, "Rollentest");
  const adminMit = await stufen(konten.admin.client);
  const kasseMit = await stufen(konten.kasse.client);
  pruefe(adminMit.admin && kasseMit.kasse, "Mit Code kommen beide wieder durch",
    JSON.stringify({ admin: adminMit.admin, kasse: kasseMit.kasse }));

  // Eine frische Anmeldung ohne Code ist wieder nur aal1 — der Faktor
  // existiert, aber diese Sitzung hat ihn nicht benutzt.
  const nochmal = await anmelden(konten.admin.email);
  const frischOhne = await stufen(nochmal);
  pruefe(!frischOhne.admin, "Neue Anmeldung ohne Code zählt nicht als bestätigt");

  await schalter(schalterVorher);
  const zurueck = await stufen(konten.admin.client);
  pruefe(zurueck.admin, "Nach dem Zurückschalten geht es wie vorher");
}

async function aufraeumen() {
  if (schalterVorher) await schalter(schalterVorher).catch(() => {});
  for (const id of angelegt) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("rollentest-")).length;
  const { data: stand } = await dienst
    .from("betrieb")
    .select("wert")
    .eq("schluessel", "zwei_faktor")
    .single();
  console.log(
    `\nAufgeräumt: ${rest === 0 ? "Testkonten weg" : `NOCH DA: ${rest}`} · Schalter steht auf „${stand?.wert}“`,
  );
  if (rest !== 0 || stand?.wert !== schalterVorher) process.exitCode = 1;
}

try {
  await durchspielen();
} catch (fehler) {
  console.error("\nAbgebrochen:", fehler.message ?? fehler);
  process.exitCode = 1;
} finally {
  await aufraeumen();
}
