/**
 * Prüft VIP-Tickets auf Namen (0028) mit echten Anmeldungen.
 *
 *   node scripts/vip-testen.mjs
 *
 * Legt eine VIP-Anfrage und zwei Test-Events an, stellt mit einem
 * Wegwerf-Admin (samt zweitem Faktor) benannte Tickets aus, benennt um,
 * entfernt und ergänzt Gäste, lässt über QR und Namensliste ein und
 * storniert am Ende. Dazu: Die Gästeliste lässt VIP-Einträge in Ruhe, und
 * ohne Admin-Rolle geht nichts. Räumt am Ende alles weg.
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
const angelegt = { events: [], anfrage: null, nutzer: [] };

function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) process.exitCode = 1;
  return bedingung;
}

async function personal(rolle) {
  const email = `viptest-${rolle}-${K}@lunar-events.de`;
  const { data: neu, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`Konto ${rolle}: ${error.message}`);
  angelegt.nutzer.push(neu.user.id);
  await dienst
    .from("mitarbeiter")
    .insert({ user_id: neu.user.id, name: `VIP-Test ${rolle}`, rolle, aktiv: true });
  const { data: link } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL_, OEFFENTLICH, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: vf } = await client.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  if (vf) throw new Error(`Anmeldung ${rolle}: ${vf.message}`);
  return client;
}

async function event(slug) {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data, error } = await dienst
    .from("events")
    .insert({
      slug: `${slug}-${K}`,
      titel: "TEST VIP",
      kategorie: "club",
      status: "veroeffentlicht",
      beginn: new Date(Date.now() + 30 * 86400000).toISOString(),
      ort_id: ort.id,
      veranstalter: "Lunar Events",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.events.push(data.id);
  return data.id;
}

async function durchspielen() {
  const ev = await event("test-vip");
  const anderesEv = await event("test-vip-anderes");
  const { data: anfrage, error: afFehler } = await dienst
    .from("vip_anfragen")
    .insert({ name: "Anna Anfrage", email: `viptest-gast-${K}@example.invalid`, gaeste: 3, event_id: ev })
    .select("id")
    .single();
  if (afFehler) throw new Error(`Anfrage: ${afFehler.message}`);
  angelegt.anfrage = anfrage.id;

  const admin = await personal("admin");
  await richteZweitenFaktorEin(admin, "VIP-Test");
  const einlass = await personal("einlass");
  const anon = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false } });

  const speichere = (client, gaeste, felder = {}) =>
    client.rpc("speichere_vip", {
      p_anfrage_id: anfrage.id,
      p_event_id: ev,
      p_tisch: "Tisch 4",
      p_betrag_cent: 60000,
      p_bezahlt: false,
      p_gaeste: gaeste,
      ...felder,
    });
  const aktive = async () =>
    (
      await dienst.from("gaeste").select("id, name, token, entfernt_am, tickets(code, status, art, platz, gast_name, phase_name, bestellung_id)")
        .eq("vip_anfrage_id", anfrage.id).is("entfernt_am", null).order("erstellt_am").order("id")
    ).data ?? [];

  console.log("— Rechte —");
  const { data: e1 } = await speichere(einlass, [{ name: "X" }]);
  pruefe(e1?.ergebnis === "keine_berechtigung", "Einlass stellt keine VIP-Tickets aus", e1?.ergebnis);
  const { error: a1 } = await speichere(anon, [{ name: "X" }]);
  pruefe(Boolean(a1), "Ohne Anmeldung geht nichts");

  console.log("\n— Ausstellen —");
  const { data: s1 } = await speichere(admin, [{ name: "Anna" }, { name: "Ben" }, { name: "Cem" }]);
  pruefe(s1?.ergebnis === "ok" && s1.gaeste.length === 3 && /^[0-9a-f]{64}$/.test(s1.token),
    "Drei Tickets ausgestellt, Link für die Anfrage", s1?.ergebnis);
  let gaeste = await aktive();
  const alle = gaeste.flatMap((g) => g.tickets);
  pruefe(alle.length === 3 && alle.every((t) => t.art === "vip" && t.platz === "Tisch 4" &&
    t.phase_name === "VIP" && t.bestellung_id === null && t.status === "gueltig"),
    "Je Gast ein VIP-Ticket mit Platz, ohne Bestellung");
  pruefe(gaeste.map((g) => g.tickets[0].gast_name).join(",") === "Anna,Ben,Cem", "Jedes Ticket trägt seinen Namen");
  const { data: af } = await dienst.from("vip_anfragen")
    .select("status, tisch, betrag_cent, bezahlt, token").eq("id", anfrage.id).single();
  pruefe(af.status === "bestaetigt" && af.betrag_cent === 60000 && !af.bezahlt && af.token === s1.token,
    "Anfrage: bestätigt, Betrag vermerkt, noch nicht bezahlt");
  const { count: verkauft } = await dienst.from("tickets")
    .select("id", { count: "exact", head: true }).eq("event_id", ev).not("bestellung_id", "is", null);
  pruefe(verkauft === 0, "VIP zählt nicht als Verkauf");

  const [anna, ben, cem] = gaeste;

  console.log("\n— Ändern —");
  const { data: s2 } = await speichere(admin,
    [{ id: anna.id, name: "Anna Z" }, { id: ben.id, name: "Ben" }, { id: cem.id, name: "Cem" }],
    { p_tisch: "Tisch 5", p_bezahlt: true });
  gaeste = await aktive();
  pruefe(s2?.ergebnis === "ok" && gaeste[0].tickets[0].gast_name === "Anna Z" &&
    gaeste.every((g) => g.tickets[0].platz === "Tisch 5"),
    "Umbenannt und umgesetzt — auf den Tickets steht der neue Stand");
  pruefe(gaeste[0].tickets[0].code === anna.tickets[0].code, "Umbenennen behält den QR-Code");

  const { data: fremd } = await speichere(admin, [{ id: crypto.randomUUID(), name: "Niemand" }]);
  pruefe(fremd?.ergebnis === "unbekannt", "Ein fremder Gast in der Liste wird abgewiesen", fremd?.ergebnis);
  const { data: anderes } = await speichere(admin, [{ id: anna.id, name: "Anna Z" }], { p_event_id: anderesEv });
  pruefe(anderes?.ergebnis === "event_fest", "Das Event bleibt, solange Tickets ausgestellt sind", anderes?.ergebnis);

  console.log("\n— Einlass —");
  const { data: q1 } = await einlass.rpc("entwerte_ticket", { p_code: anna.tickets[0].code });
  pruefe(q1?.ergebnis === "gueltig" && q1.art === "vip" && q1.gast === "Anna Z" && q1.platz === "Tisch 5",
    "Scanner: VIP, Name und Platz", JSON.stringify({ a: q1?.art, g: q1?.gast, p: q1?.platz }));
  const { data: namensliste } = await einlass.rpc("gaesteliste_einlass", { p_event_id: ev });
  pruefe(namensliste.length === 3 && namensliste.every((g) => g.vip === true && g.tisch === "Tisch 5"),
    "Namensliste am Einlass: alle drei, als VIP mit Platz");
  const { data: n1 } = await einlass.rpc("lasse_gast_ein", { p_gast_id: ben.id, p_anzahl: 1 });
  pruefe(n1?.ergebnis === "gueltig", "Ben kommt über die Namensliste rein", n1?.ergebnis);

  console.log("\n— Entfernen —");
  const { data: s3 } = await speichere(admin,
    [{ id: ben.id, name: "Ben" }, { id: cem.id, name: "Cem" }, { name: "Dora" }],
    { p_tisch: "Tisch 5" });
  gaeste = await aktive();
  pruefe(s3?.ergebnis === "schon_drin" && s3.name === "Anna Z", "Anna ist drin und lässt sich nicht entfernen");
  pruefe(gaeste.length === 3 && !gaeste.some((g) => g.name === "Dora"),
    "…und dabei ist nichts halb passiert (Dora nicht angelegt)");

  const { data: s4 } = await speichere(admin,
    [{ id: anna.id, name: "Anna Z" }, { id: ben.id, name: "Ben" }, { name: "Dora" }],
    { p_tisch: "Tisch 5" });
  gaeste = await aktive();
  const { data: cemJetzt } = await dienst.from("gaeste").select("entfernt_am, tickets(status)").eq("id", cem.id).single();
  pruefe(s4?.ergebnis === "ok" && gaeste.map((g) => g.name).join(",") === "Anna Z,Ben,Dora",
    "Cem raus, Dora rein", gaeste.map((g) => g.name).join(","));
  pruefe(cemJetzt.entfernt_am && cemJetzt.tickets.every((t) => t.status === "storniert"), "Cems Ticket ist storniert");
  const dora = gaeste[2];
  pruefe(dora.tickets.length === 1 && dora.tickets[0].art === "vip" && dora.tickets[0].platz === "Tisch 5",
    "Dora hat ein VIP-Ticket am selben Tisch");

  console.log("\n— Gästeliste lässt VIP in Ruhe —");
  const { data: g1 } = await admin.rpc("speichere_gast", {
    p_id: ben.id, p_event_id: ev, p_name: "Umbenannt", p_email: null, p_begleitung: 3, p_notiz: null,
  });
  const { data: g2 } = await admin.rpc("entferne_gast", { p_id: dora.id });
  const { data: doraJetzt } = await dienst.from("gaeste").select("name, entfernt_am").eq("id", dora.id).single();
  const { data: benJetzt } = await dienst.from("gaeste").select("name, begleitung").eq("id", ben.id).single();
  pruefe(g1?.ergebnis === "unbekannt" && g2?.ergebnis === "unbekannt" &&
    benJetzt.name === "Ben" && benJetzt.begleitung === 0 && !doraJetzt.entfernt_am,
    "speichere_gast und entferne_gast greifen nicht auf VIP-Gäste");

  console.log("\n— Stornieren —");
  const { data: st } = await admin.rpc("storniere_vip", { p_anfrage_id: anfrage.id });
  const { data: nachher } = await dienst.from("gaeste")
    .select("name, entfernt_am, tickets(status)").eq("vip_anfrage_id", anfrage.id).order("erstellt_am").order("id");
  const zustand = Object.fromEntries(nachher.map((g) => [g.name, `${g.entfernt_am ? "raus" : "da"}/${g.tickets[0].status}`]));
  pruefe(st?.ergebnis === "ok" && st.storniert === 1, "Storniert: nur Doras offenes Ticket", JSON.stringify(st));
  pruefe(zustand["Anna Z"] === "da/entwertet" && zustand.Ben === "da/entwertet" && zustand.Dora === "raus/storniert",
    "Wer drin ist, bleibt drin", JSON.stringify(zustand));
  const { data: q2 } = await einlass.rpc("entwerte_ticket", { p_code: dora.tickets[0].code });
  pruefe(q2?.ergebnis === "storniert", "Doras QR-Code zeigt am Einlass „Storniert“", q2?.ergebnis);
}

async function aufraeumen() {
  for (const ev of angelegt.events) {
    await dienst.from("tickets").delete().eq("event_id", ev);
    await dienst.from("gaeste").delete().eq("event_id", ev);
  }
  if (angelegt.anfrage) await dienst.from("vip_anfragen").delete().eq("id", angelegt.anfrage);
  for (const ev of angelegt.events) {
    await dienst.from("ereignisse").delete().eq("event_id", ev);
    await dienst.from("events").delete().eq("id", ev);
  }
  for (const id of angelegt.nutzer) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  // Zu jedem Konto legt 0004 eine Kundenzeile an — die muss mit weg.
  await dienst.from("kunden").delete().like("email", `viptest-%-${K}@lunar-events.de`);
  const { count } = await dienst.from("events")
    .select("id", { count: "exact", head: true }).like("slug", `%-${K}`);
  const { count: anfragen } = await dienst.from("vip_anfragen")
    .select("id", { count: "exact", head: true }).like("email", `viptest-%-${K}@example.invalid`);
  const { data: konten } = await dienst.auth.admin.listUsers({ perPage: 1000 });
  const rest = (konten?.users ?? []).filter((u) => u.email?.startsWith("viptest-")).length;
  const sauber = count === 0 && anfragen === 0 && rest === 0;
  console.log(`\nAufgeräumt: ${sauber ? "Events, Anfrage, Gäste, Tickets und Testkonten weg" : `NOCH DA: ${count}/${anfragen}/${rest}`}`);
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
