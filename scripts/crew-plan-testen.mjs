/**
 * Prüft `meine_schichten()` (0051), die „Mein Plan“-Liste der Crew-App:
 * nur die eigenen Schichten, das Event auch als Entwurf, vergangene höchstens
 * 20, Stunden wie schicht_stunden(). Legt ein Entwurfs-Event und zwei Konten
 * (Security, Einlass) an und räumt danach alles weg.
 *
 *   node scripts/crew-plan-testen.mjs
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

async function konto(rolle, aktiv = true) {
  const email = `lasttest-plan-${rolle}-${K}@example.invalid`;
  const { data: k, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  angelegt.konten.push(k.user.id);
  await dienst.from("mitarbeiter").upsert({ user_id: k.user.id, name: `Plantest ${rolle}`, rolle, aktiv });
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: f } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (f) throw f;
  return { id: k.user.id, client };
}

const iso = (ms) => new Date(ms).toISOString();

try {
  const { data: ort } = await dienst.from("orte").select("id, name, stadt").limit(1).single();
  const { data: ev, error } = await dienst
    .from("events")
    .insert({
      slug: `plantest-${K}`, titel: "Plantest Entwurf", kategorie: "club", status: "entwurf",
      beginn: iso(Date.now() + 48 * STUNDE), ort_id: ort.id, veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.event = ev.id;

  const security = await konto("security");
  const einlass = await konto("einlass");
  const raus = await konto("runner", false);

  const jetzt = Date.now();
  const zeilen = [
    // läuft gerade, eingecheckt
    { user_id: security.id, rolle: "security", station: "Haupteingang", beginn: iso(jetzt - STUNDE), ende: iso(jetzt + 4 * STUNDE), pause_min: 30, notiz: "Leitung: Kim", eingecheckt_am: iso(jetzt - 55 * 60000) },
    // kommt
    { user_id: security.id, rolle: "einlass", beginn: iso(jetzt + 48 * STUNDE), ende: iso(jetzt + 54 * STUNDE), pause_min: 0 },
    // fremde Schicht
    { user_id: einlass.id, rolle: "einlass", beginn: iso(jetzt + 48 * STUNDE), ende: iso(jetzt + 52 * STUNDE), pause_min: 0 },
    { user_id: raus.id, rolle: "runner", beginn: iso(jetzt + 48 * STUNDE), ende: iso(jetzt + 52 * STUNDE), pause_min: 0 },
  ];
  // 22 vergangene, je 5 h mit 30 min Pause = 4,5 h
  for (let i = 1; i <= 22; i++) {
    zeilen.push({ user_id: security.id, rolle: "security", beginn: iso(jetzt - i * 24 * STUNDE - 6 * STUNDE), ende: iso(jetzt - i * 24 * STUNDE - STUNDE), pause_min: 30 });
  }
  const { error: sf } = await dienst.from("schichten").insert(zeilen.map((z) => ({ event_id: ev.id, ...z })));
  if (sf) throw new Error(`Schichten: ${sf.message}`);

  console.log("\n— Eigene Schichten —");
  const { data: liste, error: lf } = await security.client.rpc("meine_schichten");
  pruefe(!lf && Array.isArray(liste), "Security darf abrufen", lf?.message);
  const kommend = (liste ?? []).filter((s) => new Date(s.ende).getTime() >= Date.now());
  const vorbei = (liste ?? []).filter((s) => new Date(s.ende).getTime() < Date.now());
  pruefe(kommend.length === 2, "2 kommende (laufende eingeschlossen)", kommend.length);
  pruefe(vorbei.length === 20, "Vergangene höchstens 20", vorbei.length);
  pruefe((liste ?? []).every((s) => s.event?.titel === "Plantest Entwurf"), "Entwurfs-Event mit Titel sichtbar");
  pruefe(kommend[0]?.event?.ort === `${ort.name}, ${ort.stadt}`, "Ort dabei", kommend[0]?.event?.ort);
  pruefe(kommend[0]?.station === "Haupteingang" && kommend[0]?.notiz === "Leitung: Kim" && kommend[0]?.eingecheckt_am, "Station, Notiz, eingecheckt");
  pruefe(Number(vorbei[0]?.stunden) === 4.5, "Stunden wie schicht_stunden: 4,5", vorbei[0]?.stunden);
  const reihenfolge = (liste ?? []).map((s) => s.beginn);
  pruefe(reihenfolge.every((b, i) => i === 0 || reihenfolge[i - 1] <= b), "Nach Beginn sortiert");

  console.log("\n— Fremde —");
  const { data: andere } = await einlass.client.rpc("meine_schichten");
  pruefe(andere?.length === 1, "Einlass sieht nur die eigene", andere?.length);
  const { data: inaktiv } = await raus.client.rpc("meine_schichten");
  pruefe(Array.isArray(inaktiv) && inaktiv.length === 0, "Inaktives Konto: leer");
  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });
  const { data: ohne, error: of } = await anon.rpc("meine_schichten");
  pruefe(Boolean(of) || (Array.isArray(ohne) && ohne.length === 0), "Ohne Anmeldung: nichts", of?.message);

  console.log("\n— Event bleibt verborgen —");
  const { data: direkt } = await security.client.from("events").select("id").eq("id", ev.id);
  pruefe((direkt ?? []).length === 0, "Den Entwurf selbst kann Security nicht lesen");
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
