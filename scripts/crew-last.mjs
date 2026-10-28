/**
 * Lasttest für die Crew-App (0049): prüfen, dann entscheiden.
 *
 *   node scripts/crew-last.mjs            # 1000 Tickets, 6 Geräte
 *   node scripts/crew-last.mjs 300 4      # 300 Tickets, 4 Geräte
 *
 * Wie einlass-last.mjs auf eigenen Test-Events mit echten Einlass-Sitzungen,
 * aber über die Funktionen der Crew-App: prüfen ändert nichts, Durchlauf mit
 * prüfen + reinlassen, Wettlauf, Abweisen, Rückgängig (eigenes, fremdes,
 * Admin, zu alt), Nachtragen gemischter Offline-Entscheidungen, Realtime,
 * andere Wege (Kasse, Gästeliste, Storno) über den Trigger. Am Ende muss
 * einlass_stand genau der Zahl entwerteter Tickets entsprechen.
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
const dienst = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ANZAHL = Number(process.argv[2] ?? 1000);
const GERAETE = Number(process.argv[3] ?? 6);
const WETTLAUF = 50;
const K = Date.now().toString(36);
const SLUG = `crewtest-${K}`;
const SLUG2 = `crewtest-anderes-${K}`;
const PERSONAL = (i) => `lasttest-einlass${i}-${K}@example.invalid`;
const KAEUFER = (i) => `lasttest-kaeufer${i}-${K}@example.invalid`;

let fehler = 0;
const pruefe = (ok, text, zusatz = "") => {
  console.log(`${ok ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!ok) fehler++;
};
const ms = (n) => `${Math.round(n)} ms`;
function verteilung(zeiten) {
  const s = [...zeiten].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return `p50 ${ms(p(0.5))} · p95 ${ms(p(0.95))} · max ${ms(s[s.length - 1])}`;
}

async function sitzung(email) {
  const { data: link, error } = await dienst.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(URL_, OEFFENTLICH, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: f } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (f) throw f;
  return client;
}

const angelegt = { events: [], konten: [] };

async function aufraeumen() {
  for (const evId of angelegt.events) {
    const { data: b } = await dienst.from("bestellungen").select("id").eq("event_id", evId);
    const ids = (b ?? []).map((x) => x.id);
    for (let i = 0; i < ids.length; i += 100) {
      const teil = ids.slice(i, i + 100);
      await dienst.from("tickets").delete().in("bestellung_id", teil);
      await dienst.from("bestellpositionen").delete().in("bestellung_id", teil);
      await dienst.from("bestellungen").delete().in("id", teil);
    }
    await dienst.from("phasen").delete().eq("event_id", evId);
    await dienst.from("events").delete().eq("id", evId);
  }
  for (const id of angelegt.konten) {
    await dienst.from("mitarbeiter").delete().eq("user_id", id);
    await dienst.auth.admin.deleteUser(id);
  }
  await dienst.from("kunden").delete().like("email", `lasttest-%-${K}@example.invalid`);
}

async function testEvent(slug, titel) {
  const { data: ort } = await dienst.from("orte").select("id").limit(1).single();
  const { data: ev, error } = await dienst.from("events").insert({
    slug, titel, kategorie: "club", status: "veroeffentlicht",
    beginn: new Date(Date.now() + 2 * 3600000).toISOString(), ort_id: ort.id, veranstalter: "Lunar Events",
  }).select("id").single();
  if (error) throw new Error(`Event: ${error.message}`);
  angelegt.events.push(ev.id);
  const { data: ph } = await dienst.from("phasen").insert({
    event_id: ev.id, name: "Early Bird", art: "standard", preis_cent: 2000, gebuehr_cent: 0,
    kontingent: ANZAHL + 500, verkauft: 0, aktiv: true, leistungen: [], position: 0,
  }).select("id").single();
  return { id: ev.id, phase: ph.id };
}

/** Bestellungen zu je bis zu 20 Tickets, mit Namen, über die echte Kette. */
async function kaufe(ev, gesamt, nr0) {
  const bestellungen = [];
  let rest = gesamt;
  let nr = nr0;
  while (rest > 0) {
    const menge = Math.min(rest, [1, 2, 4, 20][nr % 4]);
    bestellungen.push({ nr, menge });
    rest -= menge;
    nr++;
  }
  const codes = [];
  for (let i = 0; i < bestellungen.length; i += 10) {
    const teil = bestellungen.slice(i, i + 10);
    const erg = await Promise.all(teil.map(async ({ nr, menge }) => {
      const { data: id, error } = await dienst.rpc("reserviere", {
        p_event_id: ev.id, p_auswahl: [{ phase_id: ev.phase, menge }],
        p_email: KAEUFER(nr), p_vorname: "Last", p_nachname: `Test${nr}`,
      });
      if (error) throw new Error(`reserviere: ${error.message}`);
      await dienst.from("bestellungen").update({
        ticket_namen: Array.from({ length: menge }, (_, j) => `Gast${nr} Nummer${j + 1}`),
      }).eq("id", id);
      const { error: zf } = await dienst.rpc("bestaetige_zahlung", {
        p_bestellung_id: id, p_zahlungsart: "frei", p_referenz: "lasttest",
      });
      if (zf) throw new Error(`bestaetige_zahlung: ${zf.message}`);
      return id;
    }));
    for (let j = 0; j < erg.length; j += 50) {
      const { data } = await dienst.from("tickets").select("code").in("bestellung_id", erg.slice(j, j + 50));
      codes.push(...(data ?? []).map((t) => t.code));
    }
  }
  return codes;
}

function mische(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


const stand = async (evId) =>
  (await dienst.from("einlass_stand").select("drin").eq("event_id", evId).maybeSingle()).data?.drin ?? 0;
const entwertet = async (evId) =>
  (await dienst.from("tickets").select("id", { count: "exact", head: true }).eq("event_id", evId).eq("status", "entwertet")).count;

async function durchspielen() {
  console.log(`Crew-Lasttest: ${ANZAHL} Tickets, ${GERAETE} Geräte\n`);
  let t0 = Date.now();
  const ev = await testEvent(SLUG, "CREWTEST");
  const ev2 = await testEvent(SLUG2, "CREWTEST ANDERES EVENT");
  const NACHTRAG = 100;
  const RUECK = 6;
  const codes = mische(await kaufe(ev, ANZAHL + WETTLAUF + NACHTRAG + RUECK + 5, 0));
  const fremd = (await kaufe(ev2, 1, 100000))[0];
  await dienst.from("events").update({ status: "entwurf", kapazitaet: ANZAHL + 300 }).in("id", [ev.id, ev2.id]);
  console.log(`Aufgebaut: ${codes.length} Tickets in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

  const wettlauf = codes.splice(0, WETTLAUF);
  const nachtrag = codes.splice(0, NACHTRAG);
  const rueck = codes.splice(0, RUECK);
  const extra = codes.splice(0, 5);
  const haupt = codes;

  const geraete = [];
  const konto = async (email, rolle, name) => {
    const { data: k, error } = await dienst.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    angelegt.konten.push(k.user.id);
    await dienst.from("mitarbeiter").upsert({ user_id: k.user.id, name, rolle, aktiv: true });
    return sitzung(email);
  };
  for (let i = 0; i < GERAETE; i++) geraete.push(await konto(PERSONAL(i), "einlass", `Crewtest ${i}`));
  const admin = await konto(PERSONAL("admin"), "admin", "Crewtest Admin");

  const pruefen = (g, code) => g.rpc("einlass_pruefen", { p_code: code, p_event_id: ev.id });
  const rein = (g, code) => g.rpc("einlass_reinlassen", { p_code: code, p_event_id: ev.id });
  const zurueck = (g, code) => g.rpc("einlass_rueckgaengig", { p_code: code, p_event_id: ev.id });

  // --- 7. Realtime: ein Gerät hört mit, wie die Fußzeile der App ---
  let liveWert = null;
  let liveMeldungen = 0;
  const zuschauer = geraete[GERAETE - 1];
  const abonniert = await new Promise((fertig) => {
    const uhr = setTimeout(() => fertig(false), 10000);
    zuschauer
      .channel(`crewtest-${K}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einlass_stand", filter: `event_id=eq.${ev.id}` },
        (n) => {
          liveMeldungen++;
          liveWert = n.new?.drin ?? liveWert;
        },
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") {
          clearTimeout(uhr);
          fertig(true);
        }
      });
  });
  pruefe(abonniert, "Realtime-Abo auf einlass_stand steht");

  const { data: st } = await geraete[0].rpc("einlass_stand_abrufen", { p_event_id: ev.id });
  pruefe(st?.ergebnis === "ok" && st.drin === 0 && st.kapazitaet === ANZAHL + 300 && st.modus === "entscheiden",
    "Stand abrufen: 0 drin, Kapazität, Modus entscheiden", JSON.stringify(st));
  const { data: stFremd } = await dienst.rpc("einlass_stand_abrufen", { p_event_id: ev.id });
  pruefe(stFremd?.ergebnis === "keine_berechtigung", "Ohne Einlass-Anmeldung kein Stand");

  // --- 1. Prüfen ändert nichts ---
  console.log("\n— 1. Prüfen —");
  const p = await Promise.all(haupt.slice(0, 50).map((c, i) => pruefen(geraete[i % GERAETE], c)));
  pruefe(p.every((x) => x.data?.ergebnis === "gueltig" && x.data?.gast), "50× prüfen: gültig, mit Namen");
  pruefe((await entwertet(ev.id)) === 0 && (await stand(ev.id)) === 0, "… nichts entwertet, Stand 0");
  const { data: pf } = await pruefen(geraete[0], fremd);
  pruefe(pf?.ergebnis === "anderes_event", "Ticket eines anderen Events: anderes_event", pf?.ergebnis);

  // --- 2. Durchlauf ---
  console.log("\n— 2. Durchlauf: prüfen, dann reinlassen —");
  const zeitenP = [];
  const zeitenR = [];
  const erg = {};
  const rpcFehler = [];
  t0 = Date.now();
  await Promise.all(geraete.map(async (g, i) => {
    for (let n = i; n < haupt.length; n += GERAETE) {
      let s = performance.now();
      const a = await pruefen(g, haupt[n]);
      zeitenP.push(performance.now() - s);
      if (a.error) {
        rpcFehler.push(a.error.message);
        continue;
      }
      s = performance.now();
      const b = await rein(g, haupt[n]);
      zeitenR.push(performance.now() - s);
      if (b.error) rpcFehler.push(b.error.message);
      else erg[b.data.ergebnis] = (erg[b.data.ergebnis] ?? 0) + 1;
    }
  }));
  const dauer = (Date.now() - t0) / 1000;
  pruefe(erg.drin === haupt.length && rpcFehler.length === 0, `${haupt.length} Gäste, alle "drin"`,
    JSON.stringify(erg) + (rpcFehler.length ? ` Fehler: ${rpcFehler[0]}` : ""));
  console.log(`  Dauer ${dauer.toFixed(1)} s · ${(haupt.length / dauer).toFixed(0)} Gäste/s`);
  console.log(`  prüfen     ${verteilung(zeitenP)}`);
  console.log(`  reinlassen ${verteilung(zeitenR)}`);
  pruefe((await stand(ev.id)) === haupt.length, "Stand = Zahl der Eingelassenen", `${await stand(ev.id)}`);

  // --- 3. Wettlauf ---
  console.log("\n— 3. Wettlauf: drei Geräte, dasselbe Ticket, gleichzeitig —");
  let einmal = 0;
  for (const code of wettlauf) {
    const a = await Promise.all(geraete.slice(0, 3).map((g) => rein(g, code)));
    if (a.filter((x) => x.data?.ergebnis === "drin").length === 1) einmal++;
  }
  pruefe(einmal === wettlauf.length, `${wettlauf.length} Tickets: jeweils genau ein Gerät lässt rein`, `${einmal}`);
  pruefe((await stand(ev.id)) === (await entwertet(ev.id)), "Stand zählt keinen doppelt", `${await stand(ev.id)}`);

  // --- 4. Abweisen ---
  console.log("\n— 4. Abweisen —");
  const { data: ab } = await pruefen(geraete[0], rueck[0]);
  const { data: ab2 } = await pruefen(geraete[1], rueck[0]);
  pruefe(ab?.ergebnis === "gueltig" && ab2?.ergebnis === "gueltig", "Abgewiesen und später wieder gescannt: weiter gültig");

  // --- 5. Rückgängig ---
  console.log("\n— 5. Rückgängig —");
  const vorher = await stand(ev.id);
  await rein(geraete[0], rueck[1]);
  const { data: r1 } = await zurueck(geraete[0], rueck[1]);
  pruefe(r1?.ergebnis === "zurueck" && (await stand(ev.id)) === vorher, "Eigenes Reinlassen zurückgenommen, Stand wie vorher", r1?.ergebnis);
  const { data: r1b } = await pruefen(geraete[2], rueck[1]);
  pruefe(r1b?.ergebnis === "gueltig", "… Ticket wieder gültig");
  await rein(geraete[0], rueck[2]);
  const { data: r2 } = await zurueck(geraete[1], rueck[2]);
  pruefe(r2?.ergebnis === "nicht_erlaubt", "Fremdes Reinlassen: nicht_erlaubt", r2?.ergebnis);
  const { data: r3 } = await zurueck(admin, rueck[2]);
  pruefe(r3?.ergebnis === "zurueck", "Admin darf es", r3?.ergebnis);
  const { data: r4 } = await zurueck(geraete[0], rueck[3]);
  pruefe(r4?.ergebnis === "nicht_drin", "Nicht eingelassenes Ticket: nicht_drin", r4?.ergebnis);
  await rein(geraete[0], rueck[4]);
  await dienst.from("tickets").update({ entwertet_am: new Date(Date.now() - 31 * 60000).toISOString() }).eq("code", rueck[4]);
  const { data: r5 } = await zurueck(geraete[0], rueck[4]);
  pruefe(r5?.ergebnis === "nicht_erlaubt", "Eigenes, aber älter als 30 Minuten: nicht_erlaubt", r5?.ergebnis);
  const { data: r6 } = await zurueck(geraete[0], fremd);
  pruefe(r6?.ergebnis === "unbekannt", "Ticket eines anderen Events lässt sich hier nicht zurücknehmen", r6?.ergebnis);

  // --- 6. Nachtragen ---
  console.log("\n— 6. Nachtragen: 100 ohne Netz, 10 war ein anderes Gerät schneller, 10 zurückgenommen —");
  await Promise.all(nachtrag.slice(0, 10).map((c) => rein(geraete[1], c)));
  const aktionen = [
    ...nachtrag.map((code) => ({ code, aktion: "rein" })),
    ...nachtrag.slice(90).map((code) => ({ code, aktion: "zurueck" })),
  ];
  const vorNach = await stand(ev.id);
  t0 = Date.now();
  const { data: n1, error: n1F } = await geraete[0].rpc("einlass_nachtragen_aktionen", { p_aktionen: aktionen, p_event_id: ev.id });
  const tNach = Date.now() - t0;
  const liste = n1?.liste ?? [];
  const neuRein = liste.filter((a) => a.aktion === "rein" && a.ergebnis === "drin").length;
  const doppelt = liste.filter((a) => a.aktion === "rein" && a.ergebnis === "schon_entwertet" && !a.eigenes).length;
  const zurueckOk = liste.filter((a) => a.aktion === "zurueck" && a.ergebnis === "zurueck").length;
  pruefe(!n1F && neuRein === 90 && doppelt === 10 && zurueckOk === 10,
    "Ein Aufruf: 90 rein, 10 als zweimal drin gemeldet, 10 zurückgenommen",
    `${ms(tNach)} · ${neuRein}/${doppelt}/${zurueckOk} ${n1F?.message ?? ""}`);
  pruefe(n1?.drin === vorNach + 80 && (await stand(ev.id)) === vorNach + 80, "Stand danach stimmt", `${n1?.drin}`);
  const { data: n2 } = await geraete[0].rpc("einlass_nachtragen_aktionen", {
    p_aktionen: nachtrag.slice(10, 90).map((code) => ({ code, aktion: "rein" })),
    p_event_id: ev.id,
  });
  const eigene = (n2?.liste ?? []).filter((a) => a.ergebnis === "schon_entwertet" && a.eigenes).length;
  pruefe(eigene === 80, "Nochmal nachgetragen (Antwort kam doch an): als eigene erkannt, kein Alarm", `${eigene}`);
  const { error: zuViel } = await geraete[0].rpc("einlass_nachtragen_aktionen", {
    p_aktionen: Array.from({ length: 501 }, () => ({ code: "X", aktion: "rein" })),
    p_event_id: ev.id,
  });
  pruefe(Boolean(zuViel), "Mehr als 500 auf einmal abgelehnt");

  // --- 8. Andere Wege zählen mit ---
  console.log("\n— 8. Andere Wege —");
  const v8 = await stand(ev.id);
  await dienst.from("tickets").update({ status: "entwertet", entwertet_am: new Date().toISOString() }).in("code", extra.slice(0, 3));
  pruefe((await stand(ev.id)) === v8 + 3, "Entwertung auf anderem Weg (Kasse, Gästeliste): +3");
  await dienst.from("tickets").update({ status: "storniert" }).in("code", extra.slice(0, 1));
  pruefe((await stand(ev.id)) === v8 + 2, "Storno eines Eingelassenen: −1");

  // --- 9. Gästeliste: einlassen und zurücknehmen (0050) ---
  console.log("\n— 9. Gästeliste —");
  const { data: gast } = await admin.rpc("speichere_gast", {
    p_id: null, p_event_id: ev.id, p_name: "Crewtest Gast", p_email: null, p_begleitung: 3, p_notiz: null,
  });
  pruefe(gast?.ergebnis === "ok", "Gast mit 4 Personen angelegt", gast?.ergebnis);
  const v9 = await stand(ev.id);
  const { data: g1 } = await geraete[0].rpc("lasse_gast_ein", { p_gast_id: gast.id, p_anzahl: 3 });
  pruefe(g1?.eingelassen === 3 && (await stand(ev.id)) === v9 + 3, "3 über die Gästeliste rein, Stand +3");
  const { data: g2 } = await geraete[1].rpc("gast_einlass_rueckgaengig", { p_gast_id: gast.id, p_anzahl: 1 });
  pruefe(g2?.ergebnis === "nicht_erlaubt", "Fremdes Gerät darf nicht zurücknehmen", g2?.ergebnis);
  const { data: g3 } = await geraete[0].rpc("gast_einlass_rueckgaengig", { p_gast_id: gast.id, p_anzahl: 2 });
  pruefe(g3?.ergebnis === "zurueck" && g3.anzahl === 2 && g3.drin === 1 && (await stand(ev.id)) === v9 + 1,
    "Eigenes: 2 zurück, 1 bleibt drin, Stand passt", JSON.stringify(g3));
  const { data: g4 } = await admin.rpc("gast_einlass_rueckgaengig", { p_gast_id: gast.id, p_anzahl: 5 });
  pruefe(g4?.ergebnis === "zurueck" && g4.anzahl === 1 && g4.drin === 0, "Admin: der letzte zurück, nicht mehr als drin", JSON.stringify(g4));
  const { data: g5 } = await geraete[0].rpc("gast_einlass_rueckgaengig", { p_gast_id: gast.id, p_anzahl: 1 });
  pruefe(g5?.ergebnis === "nicht_drin", "Niemand mehr drin: nicht_drin", g5?.ergebnis);
  const { data: g6 } = await geraete[0].rpc("lasse_gast_ein", { p_gast_id: gast.id, p_anzahl: 9 });
  pruefe(g6?.eingelassen === 4, "Danach wieder einlassbar, höchstens 4", `${g6?.eingelassen}`);
  await dienst.from("gaeste").delete().eq("id", gast.id);
  pruefe((await stand(ev.id)) === v9, "Gast gelöscht: Stand wieder wie vorher");

  // --- 7. Realtime-Ergebnis ---
  await new Promise((r) => setTimeout(r, 3000));
  const endstand = await stand(ev.id);
  pruefe(liveMeldungen > 0 && liveWert === endstand, "Realtime: das mithörende Gerät sieht den Endstand",
    `${liveMeldungen} Meldungen, zuletzt ${liveWert}, Datenbank ${endstand}`);
  await zuschauer.removeAllChannels();

  // --- Endstand ---
  console.log("\n— Endstand —");
  pruefe(endstand === (await entwertet(ev.id)), "einlass_stand = entwertete Tickets", `${endstand}`);
  pruefe((await entwertet(ev2.id)) === 0, "Das andere Event blieb unberührt");
}

try {
  await durchspielen();
} catch (f) {
  console.error("\nAbgebrochen:", f.message ?? f);
  fehler++;
} finally {
  await aufraeumen().catch((f) => console.error("Aufräumen:", f.message));
  console.log(fehler ? `\n${fehler} Fehler. Aufgeräumt.` : "\nAlles grün. Aufgeräumt.");
  process.exit(fehler ? 1 : 0);
}
