/**
 * Legt Personal an oder ändert Rollen.
 *
 *   node scripts/mitarbeiter.mjs                          # auflisten
 *   node scripts/mitarbeiter.mjs max@lunar.de "Max M" admin
 *   node scripts/mitarbeiter.mjs max@lunar.de --weg
 *
 * Rollen:
 *   admin    — alles, auch Personal verwalten
 *   team     — Events, Preise, Bestellungen, Auswertungen
 *   einlass  — nur Tickets scannen und entwerten
 *
 * Es gibt bewusst keine Oberfläche dafür. Wer Personal anlegen darf,
 * bestimmt, wer an die Kasse kommt — das gehört nicht hinter einen
 * Knopf, den man versehentlich drückt.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ROLLEN = ["admin", "team", "einlass"];
const [, , email, zweites, drittes] = process.argv;

async function auflisten() {
  const { data, error } = await db
    .from("mitarbeiter")
    .select("user_id, name, rolle, aktiv")
    .order("rolle");
  if (error) throw error;
  if (!data.length) {
    console.log("Noch kein Personal angelegt.");
    console.log('Anlegen: node scripts/mitarbeiter.mjs name@firma.de "Name" admin');
    return;
  }

  const { data: konten } = await db.auth.admin.listUsers();
  for (const m of data) {
    const konto = konten.users.find((u) => u.id === m.user_id);
    console.log(
      `${m.aktiv ? "●" : "○"} ${(konto?.email ?? m.user_id).padEnd(34)} ${m.rolle.padEnd(8)} ${m.name}`,
    );
  }
}

async function findeOderLadeEin(adresse) {
  const { data: konten } = await db.auth.admin.listUsers();
  const vorhanden = konten.users.find(
    (u) => u.email?.toLowerCase() === adresse.toLowerCase(),
  );
  if (vorhanden) return vorhanden;

  // Noch kein Konto: eines anlegen und die Adresse gleich als bestätigt
  // führen. Die Person meldet sich danach per Anmeldelink an.
  const { data, error } = await db.auth.admin.createUser({
    email: adresse,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Konto angelegt für ${adresse}.`);
  return data.user;
}

async function entfernen(adresse) {
  const { data: konten } = await db.auth.admin.listUsers();
  const konto = konten.users.find(
    (u) => u.email?.toLowerCase() === adresse.toLowerCase(),
  );
  if (!konto) return console.log("Kein Konto zu dieser Adresse.");

  // Nur die Berechtigung wird entzogen, das Konto bleibt — sonst
  // verschwänden auch die Tickets, die diese Person privat gekauft hat.
  const { error } = await db.from("mitarbeiter").delete().eq("user_id", konto.id);
  if (error) throw error;
  console.log(`${adresse} hat keine Mitarbeiterrechte mehr.`);
}

async function anlegen(adresse, name, rolle) {
  if (!ROLLEN.includes(rolle)) {
    console.error(`Unbekannte Rolle "${rolle}". Erlaubt: ${ROLLEN.join(", ")}`);
    process.exit(1);
  }
  const konto = await findeOderLadeEin(adresse);
  const { error } = await db
    .from("mitarbeiter")
    .upsert({ user_id: konto.id, name, rolle, aktiv: true }, { onConflict: "user_id" });
  if (error) throw error;

  console.log(`${name} <${adresse}> ist jetzt "${rolle}".`);
  console.log("Anmelden kann sich die Person über /konto mit dieser Adresse.");
}

try {
  if (!email) await auflisten();
  else if (zweites === "--weg") await entfernen(email);
  else if (!zweites || !drittes) {
    console.error('Aufruf: node scripts/mitarbeiter.mjs adresse "Name" rolle');
    process.exit(1);
  } else await anlegen(email, zweites, drittes);
} catch (fehler) {
  console.error("Fehlgeschlagen:", fehler.message ?? fehler);
  process.exit(1);
}
