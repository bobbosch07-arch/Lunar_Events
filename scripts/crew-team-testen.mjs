/**
 * Prüft den Datenweg von „Team heute“ (Crew-App, Plan des Admins): Admins
 * lesen alle Schichten eines Events samt Namen und checken direkt in
 * `schichten` ein und aus — mit der Uhrzeit des Tippens, auch wenn sie erst
 * später nachgetragen wird. Alle anderen dürfen das nicht.
 *
 *   node scripts/crew-team-testen.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const OEFFENTLICH =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const K = Date.now().toString(36);
const STUNDE = 3600000;

let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? `  ${typeof zusatz === "string" ? zusatz : JSON.stringify(zusatz)}` : ""}`);
  if (!ok) fehler++;
};
const angelegt = { event: null, konten: [] };

async function konto(rolle) {
  const email = `lasttest-team-${rolle}-${K}@example.invalid`;
  const { data: k, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  angelegt.konten.push(k.user.id);
  await dienst.from("mitarbeiter").upsert({ user_id: k.user.id, name: `Teamtest ${rolle}`, rolle, aktiv: true });
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: f } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (f) throw f;
  return { id: k.user.id, client };
}

const lies = async (id) => (await dienst.from("schichten").select("eingecheckt_am, ausgecheckt_am").eq("id", id).single()).data;

try {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst
    .from("events")
    .insert({
      slug: `teamtest-${K}`, titel: "Teamtest", kategorie: "club", status: "veroeffentlicht",
      beginn: new Date(Date.now() + STUNDE).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.event = ev.id;

  const admin = await konto("admin");
  const einlass = await konto("einlass");
  const security = await konto("security");
  const t0 = Date.now();
  const { data: sch, error: sf } = await dienst
    .from("schichten")
    .insert([einlass, security].map((p, i) => ({
      event_id: ev.id, user_id: p.id, rolle: i ? "security" : "einlass",
      beginn: new Date(t0 - STUNDE).toISOString(), ende: new Date(t0 + 5 * STUNDE).toISOString(), pause_min: 30,
    })))
    .select("id, user_id");
  if (sf) throw new Error(`Schichten: ${sf.message}`);
  const sEinlass = sch.find((s) => s.user_id === einlass.id).id;
  const sSecurity = sch.find((s) => s.user_id === security.id).id;

  console.log("\n— Lesen —");
  const { data: liste } = await admin.client.from("schichten").select("id, user_id").eq("event_id", ev.id);
  pruefe(liste?.length === 2, "Admin sieht alle Schichten des Events", liste?.length);
  const { data: namen } = await admin.client.from("mitarbeiter").select("user_id, name").in("user_id", [einlass.id, security.id]);
  pruefe(namen?.length === 2, "… und die Namen dazu");
  const { data: fremd } = await einlass.client.from("schichten").select("id").eq("event_id", ev.id);
  pruefe(fremd?.length === 1, "Einlass sieht nur die eigene", fremd?.length);

  console.log("\n— Ein- und Auschecken —");
  const getippt = new Date(t0 - 10 * 60000).toISOString(); // ohne Netz getippt, später nachgetragen
  const { error: e1 } = await admin.client.from("schichten").update({ eingecheckt_am: getippt, ausgecheckt_am: null }).eq("id", sEinlass);
  pruefe(!e1 && new Date((await lies(sEinlass)).eingecheckt_am).getTime() === new Date(getippt).getTime(), "Einchecken mit der getippten Uhrzeit", e1?.message);
  const { error: e2 } = await admin.client.from("schichten").update({ ausgecheckt_am: new Date().toISOString() }).eq("id", sEinlass);
  pruefe(!e2 && (await lies(sEinlass)).ausgecheckt_am, "Auschecken", e2?.message);
  const { error: e3 } = await admin.client.from("schichten").update({ eingecheckt_am: null, ausgecheckt_am: null }).eq("id", sEinlass);
  const z = await lies(sEinlass);
  pruefe(!e3 && !z.eingecheckt_am && !z.ausgecheckt_am, "Zurücksetzen", e3?.message);
  const { error: e4 } = await admin.client.from("schichten").update({ ausgecheckt_am: new Date().toISOString() }).eq("id", sSecurity);
  pruefe(e4?.code === "23514", "Auschecken ohne Einchecken: Datenbank lehnt ab (23514)", e4?.code);

  console.log("\n— Nur Admins —");
  await einlass.client.from("schichten").update({ eingecheckt_am: new Date().toISOString() }).eq("id", sEinlass);
  pruefe(!(await lies(sEinlass)).eingecheckt_am, "Einlass kann sich nicht selbst einchecken");
  await security.client.from("schichten").update({ eingecheckt_am: new Date().toISOString() }).eq("id", sEinlass);
  pruefe(!(await lies(sEinlass)).eingecheckt_am, "Security kann niemanden einchecken");
} catch (e) {
  pruefe(false, "Abbruch", e.message);
} finally {
  if (angelegt.event) {
    await dienst.from("schichten").delete().eq("event_id", angelegt.event);
    await dienst.from("events").delete().eq("id", angelegt.event);
  }
  for (const id of angelegt.konten) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
}

console.log(fehler ? `\n${fehler} Fehler.` : "\nAlles grün. Aufgeräumt.");
process.exit(fehler ? 1 : 0);
