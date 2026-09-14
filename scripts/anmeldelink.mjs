/**
 * Erzeugt einen Anmeldelink, ohne auf eine Mail zu warten.
 *
 *   node scripts/anmeldelink.mjs adresse@example.de
 *   node scripts/anmeldelink.mjs adresse@example.de /backoffice
 *   node scripts/anmeldelink.mjs adresse@example.de /backoffice lokal
 *
 * Gedacht für zwei Fälle: die Veranstaltungsleitung kommt nicht an ihre
 * Mails, oder Supabases eingebauter Versand ist gedrosselt (zwei bis
 * vier Mails pro Stunde, und sie landen gern im Spam).
 *
 * Der Link ist ein Zugang — wer ihn hat, ist angemeldet. Er gilt eine
 * Stunde und **nur einmal**. Schon eine Linkvorschau in einem
 * Messenger kann ihn verbrauchen; dann ist er weg und es braucht einen
 * neuen.
 *
 * Jeder neue Link macht den vorherigen derselben Adresse ungültig.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const roh of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const t = roh.trim().match(/^([A-Z_]+)=(.*)$/);
  if (t) process.env[t[1]] ??= t[2].trim();
}

const email = process.argv[2];
if (!email) {
  console.error("Aufruf: node scripts/anmeldelink.mjs adresse@example.de [/ziel] [lokal]");
  process.exit(1);
}

// Git Bash unter Windows verwandelt ein führendes "/" in einen
// Windows-Pfad. Deshalb wird das Ziel hier notfalls repariert.
let ziel = process.argv[3] ?? "/backoffice";
const verirrt = ziel.match(/[/\\](backoffice|konto|einlass|events)([/\\].*)?$/i);
if (!ziel.startsWith("/") && verirrt) ziel = "/" + verirrt[1] + (verirrt[2] ?? "");
if (!ziel.startsWith("/")) ziel = "/" + ziel;

// Die oeffentliche Adresse steht hier fest und kommt bewusst NICHT aus
// NEXT_PUBLIC_SITE_URL: Die lokale .env.local zeigt auf localhost, und
// ein Link, der dorthin fuehrt, sieht live aus und ist es nicht.
const LIVE = "https://lunar-events.vercel.app";
const lokal = process.argv.includes("lokal");
const basis = lokal ? "http://localhost:3000" : LIVE;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });

if (error) {
  console.error("Fehlgeschlagen:", error.message);
  process.exit(1);
}

const link =
  `${basis}/auth/bestaetigen` +
  `?token_hash=${data.properties.hashed_token}` +
  `&type=magiclink&weiter=${encodeURIComponent(ziel)}`;

console.log(link);
console.error(`\nFür ${email}, Ziel ${ziel}. Gilt eine Stunde, nur einmal.`);
