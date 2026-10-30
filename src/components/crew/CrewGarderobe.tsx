"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GarderobeScan, MarkeInListe } from "@/app/aktionen/garderobe";
import type { GarderobeZustand } from "@/lib/typen";
import { browserClient } from "@/lib/supabase/client";
import { pruefsumme } from "@/lib/einlass";
import { ABLAGE, lies, schreib } from "@/lib/crew/ablage";
import {
  crewGarderobeZurueck,
  crewJackeAusgeben,
  crewMarkeAbgeben,
  crewMarken,
  crewMarkeScannen,
} from "@/lib/crew/garderobe";
import { CrewKamera } from "./CrewKamera";
import type { CrewEvent } from "./CrewScanner";

/** Was groß auf dem Bildschirm steht. */
type Anzeige =
  | { art: "bereit" }
  | { art: "abgabe"; id: string; name: string | null; code?: string; fehler?: string; offline?: boolean }
  | { art: "haengt"; id: string; name: string | null; nummer: string; offline?: boolean }
  | { art: "abholung"; id: string; name: string | null; nummer: string; offline?: boolean }
  | { art: "gerade"; id: string; name: string | null; nummer: string }
  | { art: "schon_abgeholt"; id?: string; name?: string | null; nummer?: string; zeitpunkt?: string }
  | { art: "fehler"; text: string; detail?: string };

type Auftrag =
  | { art: "abgeben"; id: string; nummer: string; zeit: number; eventId: string }
  | { art: "ausgeben"; id: string; zeit: number; eventId: string };

/** Dieselbe Marke wird gern zweimal hintereinander vor die Kamera gehalten. */
const SPERRE_MS = 2500;
const TAKT_MS = 20_000;
/** Wie `garderobe_scan()`: kurz nach der Abgabe wird nicht ausgegeben. */
const GERADE_MS = 3 * 60 * 1000;
const jetzt = () => Date.now();

const ZUSTAND_TEXT: Record<GarderobeZustand, string> = {
  offen: "Nicht abgegeben",
  haengt: "Hängt",
  abgeholt: "Abgeholt",
  storniert: "Storniert",
};

const TASTEN = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"] as const;

const uhr = (iso: string | number) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/**
 * Garderobe der Crew-App (Design: 08 · Abgabe, 09 · Abholung), nach dem
 * Tresen unter /garderobe (0027): Marke scannen — hängt noch nichts, wird die
 * Bügelnummer eingetippt; hängt schon etwas, steht die Nummer groß da und die
 * Abholung ist mit dem einen Scan verbucht (entschieden 30.10., wie bisher).
 * Den Umschalter Abgabe/Abholung aus dem Design gibt es deshalb nicht: Was
 * dran ist, weiß die Marke.
 *
 * Ohne Netz entscheidet die gespeicherte Liste (Prüfsummen), Abgaben und
 * Ausgaben werden gesammelt und nachgereicht. Ein Bügel, den zwei Geräte ohne
 * Netz vergeben haben, fällt erst dann auf — als Konflikt oben im Band.
 */
export function CrewGarderobe({
  eventId,
  online,
  events,
  setEventId,
}: {
  eventId: string;
  online: boolean;
  /** Nur für die Rolle Garderobe: Sie hat keinen Scanner-Kopf mit Eventwahl. */
  events?: CrewEvent[];
  setEventId?: (id: string) => void;
}) {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const holeDb = () => (db.current ??= browserClient());

  const [anzeige, setAnzeigeZustand] = useState<Anzeige>({ art: "bereit" });
  const anzeigeRef = useRef<Anzeige>(anzeige);
  const [nummer, setNummer] = useState("");
  const [arbeitet, setArbeitet] = useState(false);
  const [liste, setListeZustand] = useState<MarkeInListe[]>([]);
  const listeRef = useRef<MarkeInListe[]>([]);
  const [puffer, setPufferZustand] = useState<Auftrag[]>([]);
  const pufferRef = useRef<Auftrag[]>([]);
  const [konflikte, setKonflikte] = useState<string[]>([]);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [suchen, setSuchen] = useState(false);
  const [suche, setSuche] = useState("");
  const [getippt, setGetippt] = useState("");
  const zuletzt = useRef<{ code: string; zeit: number } | null>(null);
  // Wann dieses Gerät eine Marke aufgehängt hat — für „gerade abgegeben“
  // ohne Netz, wo die Liste die Uhrzeit nicht kennt.
  const lokaleAbgaben = useRef<Record<string, number>>({});
  const nachreichenLaeuft = useRef(false);

  function setAnzeige(neu: Anzeige) {
    anzeigeRef.current = neu;
    setAnzeigeZustand(neu);
  }

  const setzeListe = useCallback(
    (neu: MarkeInListe[]) => {
      listeRef.current = neu;
      setListeZustand(neu);
      void schreib(ABLAGE.marken(eventId), neu);
    },
    [eventId],
  );

  const setzePuffer = useCallback((neu: Auftrag[]) => {
    pufferRef.current = neu;
    setPufferZustand(neu);
    void schreib(ABLAGE.garderobePuffer, neu);
  }, []);

  const aendereMarke = useCallback(
    (id: string, aenderung: Partial<MarkeInListe>) => {
      setzeListe(listeRef.current.map((m) => (m.id === id ? { ...m, ...aenderung } : m)));
    },
    [setzeListe],
  );

  const name = (id: string) => listeRef.current.find((m) => m.id === id)?.name ?? null;

  // Gespeicherten Stand sofort zeigen, auch ohne Netz.
  useEffect(() => {
    let aktiv = true;
    void Promise.all([lies<MarkeInListe[]>(ABLAGE.marken(eventId), []), lies<Auftrag[]>(ABLAGE.garderobePuffer, [])]).then(
      ([marken, p]) => {
        if (!aktiv) return;
        if (listeRef.current.length === 0) {
          listeRef.current = marken;
          setListeZustand(marken);
        }
        pufferRef.current = p;
        setPufferZustand(p);
      },
    );
    return () => {
      aktiv = false;
    };
  }, [eventId]);

  const ladeListe = useCallback(async () => {
    const marken = await crewMarken(holeDb(), eventId);
    if (!marken) return;
    // Was noch nicht nachgereicht ist, bleibt so, wie es am Tresen war.
    const offen = new Map(pufferRef.current.map((a) => [a.id, a]));
    setzeListe(
      marken.map((m) => {
        const a = offen.get(m.id);
        if (!a) return m;
        return a.art === "abgeben" ? { ...m, zustand: "haengt" as const, nummer: a.nummer } : { ...m, zustand: "abgeholt" as const };
      }),
    );
  }, [eventId, setzeListe]);

  const nachreichen = useCallback(async () => {
    if (nachreichenLaeuft.current) return;
    const offen = [...pufferRef.current];
    if (offen.length === 0) return;
    nachreichenLaeuft.current = true;
    const uebrig: Auftrag[] = [];
    const neueKonflikte: string[] = [];
    try {
      for (const auftrag of offen) {
        if (auftrag.art === "abgeben") {
          const r = await crewMarkeAbgeben(holeDb(), auftrag.id, auftrag.nummer);
          if (!r) {
            uebrig.push(auftrag);
            continue;
          }
          const wer = listeRef.current.find((m) => m.id === auftrag.id)?.name ?? "Unbekannt";
          if (r.ergebnis === "nummer_belegt") {
            neueKonflikte.push(`Bügel ${auftrag.nummer} war doppelt vergeben (${wer}, ${uhr(auftrag.zeit)}). Bitte nachsehen.`);
          } else if (r.ergebnis === "schon_abgegeben" && r.nummer && r.nummer !== auftrag.nummer) {
            neueKonflikte.push(`${wer}: im System an Bügel ${r.nummer}, hier eingetippt ${auftrag.nummer}.`);
          }
        } else if (!(await crewJackeAusgeben(holeDb(), auftrag.id))) {
          uebrig.push(auftrag);
        }
      }
    } finally {
      nachreichenLaeuft.current = false;
    }
    // Was während des Nachreichens dazukam, geht nicht verloren.
    const neu = pufferRef.current.filter((a) => !offen.includes(a));
    setzePuffer([...uebrig, ...neu]);
    if (neueKonflikte.length > 0) setKonflikte((k) => [...neueKonflikte, ...k]);
    if (uebrig.length === 0) await ladeListe();
  }, [ladeListe, setzePuffer]);

  // Takt: nachreichen, dann den Stand der anderen Geräte holen.
  useEffect(() => {
    if (!online) return;
    let aus = false;
    const lauf = async () => {
      if (aus) return;
      await nachreichen();
      if (!aus) await ladeListe();
    };
    void lauf();
    const takt = setInterval(() => void lauf(), TAKT_MS);
    return () => {
      aus = true;
      clearInterval(takt);
    };
  }, [online, ladeListe, nachreichen]);

  function zeigeScan(e: GarderobeScan, code: string) {
    switch (e.ergebnis) {
      case "abgabe":
        setNummer("");
        setAnzeige({ art: "abgabe", id: e.id!, name: e.name ?? null, code });
        return;
      case "abholung":
        if (navigator.vibrate) navigator.vibrate(40);
        aendereMarke(e.id!, { zustand: "abgeholt" });
        setAnzeige({ art: "abholung", id: e.id!, name: e.name ?? null, nummer: e.nummer ?? "?" });
        return;
      case "gerade_abgegeben":
        setAnzeige({ art: "gerade", id: e.id!, name: e.name ?? null, nummer: e.nummer ?? "?" });
        return;
      case "schon_abgeholt":
        if (e.id) aendereMarke(e.id, { zustand: "abgeholt" });
        setAnzeige({ art: "schon_abgeholt", id: e.id, name: e.name, nummer: e.nummer, zeitpunkt: e.zeitpunkt });
        return;
      case "storniert":
        setAnzeige({ art: "fehler", text: "Storniert", detail: e.name ?? undefined });
        return;
      case "anderes_event":
        setAnzeige({ art: "fehler", text: "Anderes Event", detail: e.event });
        return;
      case "ticket":
        setAnzeige({ art: "fehler", text: "Das ist ein Ticket", detail: "Die Garderobenmarke steht auf der Ticketseite unter den Tickets." });
        return;
      case "keine_berechtigung":
        setAnzeige({ art: "fehler", text: "Nicht berechtigt", detail: "Anmeldung abgelaufen? Im Plan abmelden und neu anmelden." });
        return;
      default:
        setAnzeige({ art: "fehler", text: "Unbekannt" });
    }
  }

  async function scanOhneNetz(code: string) {
    if (!code.startsWith("G-")) {
      setAnzeige({ art: "fehler", text: "Keine Garderobenmarke", detail: "Garderobenmarken beginnen mit „G-“." });
      return;
    }
    const summe = await pruefsumme(code);
    const marke = listeRef.current.find((m) => m.summe === summe);
    if (!marke) {
      setAnzeige({ art: "fehler", text: "Unbekannt", detail: "Ohne Netz und nicht in der gespeicherten Liste. Name suchen oder später nochmal scannen." });
      return;
    }
    if (marke.zustand === "storniert") {
      setAnzeige({ art: "fehler", text: "Storniert", detail: marke.name ?? undefined });
    } else if (marke.zustand === "offen") {
      setNummer("");
      setAnzeige({ art: "abgabe", id: marke.id, name: marke.name, code, offline: true });
    } else if (marke.zustand === "abgeholt") {
      setAnzeige({ art: "schon_abgeholt", id: marke.id, name: marke.name, nummer: marke.nummer ?? undefined });
    } else {
      const seit = lokaleAbgaben.current[marke.id];
      if (seit && jetzt() - seit < GERADE_MS) {
        setAnzeige({ art: "gerade", id: marke.id, name: marke.name, nummer: marke.nummer ?? "?" });
        return;
      }
      setzePuffer([...pufferRef.current, { art: "ausgeben", id: marke.id, zeit: jetzt(), eventId }]);
      aendereMarke(marke.id, { zustand: "abgeholt" });
      setAnzeige({ art: "abholung", id: marke.id, name: marke.name, nummer: marke.nummer ?? "?", offline: true });
    }
  }

  async function verarbeite(roh: string) {
    const code = roh.trim().toUpperCase();
    if (!code) return;
    const t = jetzt();
    if (zuletzt.current && zuletzt.current.code === code && t - zuletzt.current.zeit < SPERRE_MS) return;
    // Wartet eine Marke auf ihre Bügelnummer, ändert ein Scan nichts —
    // erst tippen, dann weiter.
    if (anzeigeRef.current.art === "abgabe") return;
    zuletzt.current = { code, zeit: t };
    setMeldung(null);
    const e = navigator.onLine ? await crewMarkeScannen(holeDb(), code, eventId) : null;
    if (e) zeigeScan(e, code);
    else await scanOhneNetz(code);
  }

  const beiCode = (code: string) => {
    if (!suchen) void verarbeite(code);
  };

  async function haengeAuf(id: string, eingabe: string) {
    const nr = eingabe.trim().toUpperCase();
    if (nr.length < 1 || nr.length > 12 || arbeitet) return;
    const vorher = anzeigeRef.current;
    const code = vorher.art === "abgabe" ? vorher.code : undefined;
    setArbeitet(true);
    const r = navigator.onLine ? await crewMarkeAbgeben(holeDb(), id, nr) : null;
    setArbeitet(false);
    setNummer("");
    if (r?.ergebnis === "ok") {
      if (navigator.vibrate) navigator.vibrate(40);
      lokaleAbgaben.current[id] = jetzt();
      aendereMarke(id, { zustand: "haengt", nummer: nr });
      setAnzeige({ art: "haengt", id, name: r.name ?? name(id), nummer: nr });
    } else if (r?.ergebnis === "nummer_belegt") {
      setAnzeige({ art: "abgabe", id, name: name(id), code, fehler: `Bügel ${nr} ist schon belegt.` });
    } else if (r?.ergebnis === "schon_abgegeben") {
      aendereMarke(id, { zustand: r.zustand ?? "haengt", nummer: r.nummer ?? null });
      setAnzeige({ art: "haengt", id, name: name(id), nummer: r.nummer ?? "?" });
    } else if (r) {
      setAnzeige({
        art: "fehler",
        text: r.ergebnis === "storniert" ? "Storniert" : r.ergebnis === "keine_berechtigung" ? "Nicht berechtigt" : "Unbekannt",
      });
    } else if (listeRef.current.some((m) => m.zustand === "haengt" && m.nummer === nr && m.id !== id)) {
      // Ohne Netz: den Bügel nur gegen die eigene Liste prüfen, nachreichen.
      setAnzeige({ art: "abgabe", id, name: name(id), code, fehler: `Bügel ${nr} ist laut Liste schon belegt.`, offline: true });
    } else {
      lokaleAbgaben.current[id] = jetzt();
      setzePuffer([...pufferRef.current, { art: "abgeben", id, nummer: nr, zeit: jetzt(), eventId }]);
      aendereMarke(id, { zustand: "haengt", nummer: nr });
      setAnzeige({ art: "haengt", id, name: name(id), nummer: nr, offline: true });
    }
  }

  /** Ausgeben ohne Scan: aus der Suche oder „trotzdem ausgeben“. */
  async function gibAus(id: string) {
    if (arbeitet) return;
    setArbeitet(true);
    const r = navigator.onLine ? await crewJackeAusgeben(holeDb(), id) : null;
    setArbeitet(false);
    setSuchen(false);
    if (r?.ergebnis === "abholung" || r?.ergebnis === "schon_abgeholt") {
      aendereMarke(id, { zustand: "abgeholt" });
      setAnzeige(
        r.ergebnis === "abholung"
          ? { art: "abholung", id, name: r.name ?? name(id), nummer: r.nummer ?? "?" }
          : { art: "schon_abgeholt", id, name: name(id), nummer: r.nummer, zeitpunkt: r.zeitpunkt },
      );
    } else if (r) {
      setAnzeige({ art: "fehler", text: r.ergebnis === "nicht_abgegeben" ? "Nicht abgegeben" : "Geht nicht" });
    } else {
      const marke = listeRef.current.find((m) => m.id === id);
      setzePuffer([...pufferRef.current, { art: "ausgeben", id, zeit: jetzt(), eventId }]);
      aendereMarke(id, { zustand: "abgeholt" });
      setAnzeige({ art: "abholung", id, name: marke?.name ?? null, nummer: marke?.nummer ?? "?", offline: true });
    }
  }

  /** Einen Schritt zurück: abgeholt → hängt, hängt → nicht abgegeben. Nur mit Netz. */
  async function rueckgaengig(id: string) {
    if (arbeitet) return;
    setArbeitet(true);
    await nachreichen();
    const r = navigator.onLine ? await crewGarderobeZurueck(holeDb(), id) : null;
    setArbeitet(false);
    if (!r) {
      setMeldung("Rückgängig geht nur mit Netz.");
    } else if (r.ergebnis === "ok") {
      aendereMarke(id, { zustand: r.zustand ?? "offen", nummer: r.nummer ?? null });
      setMeldung(r.zustand === "haengt" ? `Hängt wieder an Bügel ${r.nummer}.` : "Abgabe zurückgenommen.");
      setAnzeige({ art: "bereit" });
    } else if (r.ergebnis === "nummer_belegt") {
      setMeldung(`Bügel ${r.nummer} ist inzwischen neu vergeben. Bitte von Hand klären.`);
    } else {
      setMeldung("Da gibt es nichts zurückzunehmen.");
    }
  }

  function taste(k: (typeof TASTEN)[number]) {
    if (anzeige.art !== "abgabe") return;
    if (k === "del") setNummer((n) => n.slice(0, -1));
    else if (k === "ok") void haengeAuf(anzeige.id, nummer);
    else setNummer((n) => (n + k).slice(0, 6));
  }

  function abgabeAus(id: string) {
    setSuchen(false);
    setNummer("");
    setAnzeige({ art: "abgabe", id, name: name(id) });
  }

  const stand = useMemo(() => {
    let haengt = 0;
    let gesamt = 0;
    for (const m of liste) {
      if (m.zustand === "storniert") continue;
      gesamt++;
      if (m.zustand === "haengt") haengt++;
    }
    return { haengt, gesamt };
  }, [liste]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return liste.filter((m) => m.zustand === "haengt").slice(0, 30);
    return liste
      .filter((m) => (m.name ?? "").toLowerCase().includes(q) || m.bestellnummer.toLowerCase().includes(q) || (m.nummer ?? "").toLowerCase() === q)
      .slice(0, 30);
  }, [liste, suche]);

  const offenHier = puffer.filter((a) => a.eventId === eventId).length;

  return (
    <>
      <header className="crew-titelkopf">
        <span className="crew-titel">Garderobe</span>
        <span className="crew-garderobe-kopf">
          <span className="crew-titel-zahl">
            {stand.haengt} hängen · {stand.gesamt} Marken
          </span>
          <button
            type="button"
            className="btn btn-secondary crew-garderobe-suchen"
            aria-pressed={suchen}
            onClick={() => {
              setSuchen((s) => !s);
              setSuche("");
            }}
          >
            <i className={`ph-bold ${suchen ? "ph-qr-code" : "ph-magnifying-glass"}`} aria-hidden="true" />
            {suchen ? "Scannen" : "Suchen"}
          </button>
        </span>
      </header>

      {events && setEventId && events.length > 1 ? (
        <select className="input crew-garderobe-event" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.titel} · {e.wann}
            </option>
          ))}
        </select>
      ) : null}
      {!online ? (
        <div role="status" className="crew-band" data-art="offline">
          <i className="ph-bold ph-wifi-slash" aria-hidden="true" />
          <span>Ohne Netz: Die gespeicherte Liste entscheidet{offenHier ? ` · ${offenHier} warten aufs Nachreichen` : ""}.</span>
        </div>
      ) : null}
      {konflikte.map((k, i) => (
        <div key={`${i}-${k}`} role="alert" className="crew-band" data-art="doppelt">
          <i className="ph-bold ph-warning" aria-hidden="true" />
          <span>{k}</span>
          <button type="button" className="crew-band-aktion" onClick={() => setKonflikte((alt) => alt.filter((_, j) => j !== i))}>
            OK
          </button>
        </div>
      ))}
      {meldung ? (
        <div role="status" className="crew-band" data-art="gut">
          <i className="ph-bold ph-info" aria-hidden="true" />
          <span>{meldung}</span>
          <button type="button" className="crew-band-aktion" onClick={() => setMeldung(null)}>
            OK
          </button>
        </div>
      ) : null}

      {suchen ? (
        <>
          <div className="crew-suche">
            <span className="crew-suchfeld">
              <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
              <input
                className="input"
                type="search"
                placeholder="Name, Bestellnummer oder Bügel"
                aria-label="Marken durchsuchen"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </span>
          </div>
          <ul className="crew-gaeste">
            {treffer.length === 0 ? (
              <li className="crew-gaeste-leer">
                {liste.length === 0 ? "Für dieses Event gibt es keine Garderobenmarken." : suche ? "Nichts gefunden." : "Gerade hängt nichts."}
              </li>
            ) : (
              treffer.map((m) => (
                <li key={m.id} className="crew-gast">
                  <span className="crew-gast-text">
                    <span className="crew-gast-name">{m.name ?? "Ohne Namen"}</span>
                    <span className="crew-gast-info">
                      <span>{m.bestellnummer}</span>
                      <span>
                        · {ZUSTAND_TEXT[m.zustand]}
                        {m.nummer && m.zustand !== "offen" ? ` · Bügel ${m.nummer}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="crew-gast-knoepfe">
                    {m.zustand === "offen" ? (
                      <button type="button" className="btn btn-primary crew-gast-knopf" onClick={() => abgabeAus(m.id)} disabled={arbeitet}>
                        Aufhängen
                      </button>
                    ) : m.zustand === "haengt" ? (
                      <button type="button" className="btn btn-primary crew-gast-knopf" onClick={() => void gibAus(m.id)} disabled={arbeitet}>
                        Ausgeben
                      </button>
                    ) : m.zustand === "abgeholt" ? (
                      <button type="button" className="btn btn-secondary crew-gast-knopf" onClick={() => void rueckgaengig(m.id)} disabled={arbeitet}>
                        Rückgängig
                      </button>
                    ) : null}
                  </span>
                </li>
              ))
            )}
          </ul>
        </>
      ) : anzeige.art === "abgabe" ? (
        <div className="crew-abgabe">
          <div className="crew-abgabe-marke">
            <i className="ph-fill ph-check-circle" aria-hidden="true" />
            <span>
              <span className="crew-abgabe-titel">{anzeige.code ? `Marke ${anzeige.code} erkannt` : "Marke aufhängen"}</span>
              <span className="crew-abgabe-name">
                {anzeige.name ?? "Ohne Namen"}
                {anzeige.offline ? " · ohne Netz" : ""}
              </span>
            </span>
          </div>
          <div className="field">
            <span className="crew-kasse-label">Bügelnummer</span>
            <output className="crew-buegel" aria-live="polite" data-fehler={anzeige.fehler ? true : undefined}>
              {nummer || "–"}
              <span className="crew-buegel-strich" aria-hidden="true" />
            </output>
            {anzeige.fehler ? (
              <p className="crew-fehler" role="alert">
                {anzeige.fehler}
              </p>
            ) : null}
          </div>
          <div className="crew-tasten">
            {TASTEN.map((k) => (
              <button
                key={k}
                type="button"
                className="btn btn-secondary crew-taste"
                data-art={k === "ok" ? "ok" : undefined}
                aria-label={k === "del" ? "Löschen" : k === "ok" ? "Speichern" : k}
                onClick={() => taste(k)}
                disabled={arbeitet || (k === "ok" && !nummer)}
              >
                {k === "del" ? <i className="ph-bold ph-backspace" aria-hidden="true" /> : k === "ok" ? <i className="ph-bold ph-check" aria-hidden="true" /> : k}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost crew-abgabe-abbrechen" onClick={() => setAnzeige({ art: "bereit" })}>
            Abbrechen
          </button>
        </div>
      ) : null}

      {/* Die Kamera bleibt aufgebaut, auch während getippt oder gesucht wird —
          sonst müsste sie jedes Mal neu freigegeben werden. */}
      <div className="crew-garderobe-kamera" hidden={suchen || anzeige.art === "abgabe"}>
        <CrewKamera beiCode={beiCode}>
          {anzeige.art !== "bereit" && anzeige.art !== "abgabe" ? (
            <Ergebnis anzeige={anzeige} arbeitet={arbeitet} weiter={() => setAnzeige({ art: "bereit" })} ausgeben={gibAus} zurueck={rueckgaengig} />
          ) : null}
        </CrewKamera>
        <form
          className="crew-eingabe"
          onSubmit={(e) => {
            e.preventDefault();
            const code = getippt;
            setGetippt("");
            zuletzt.current = null;
            void verarbeite(code);
          }}
        >
          <input
            className="input"
            placeholder="G-… eintippen"
            aria-label="Markencode eintippen"
            value={getippt}
            onChange={(e) => setGetippt(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn btn-secondary" disabled={!getippt.trim()}>
            Prüfen
          </button>
        </form>
      </div>
    </>
  );
}

/** Liegt über dem Kamerabild: Nummer groß, damit man sie vom Tresen aus liest. */
function Ergebnis({
  anzeige,
  arbeitet,
  weiter,
  ausgeben,
  zurueck,
}: {
  anzeige: Exclude<Anzeige, { art: "bereit" } | { art: "abgabe" }>;
  arbeitet: boolean;
  weiter: () => void;
  ausgeben: (id: string) => void;
  zurueck: (id: string) => void;
}) {
  const art = anzeige.art === "abholung" || anzeige.art === "haengt" ? "gut" : anzeige.art === "fehler" ? "nein" : "schon";
  return (
    <div className="crew-garderobe-ergebnis" data-art={art} role="status" aria-live="assertive">
      {anzeige.art === "fehler" ? (
        <>
          <span className="crew-garderobe-kicker">
            <i className="ph-fill ph-x-circle" aria-hidden="true" /> Garderobe
          </span>
          <span className="crew-garderobe-wort">{anzeige.text}</span>
          {anzeige.detail ? <span className="crew-garderobe-detail">{anzeige.detail}</span> : null}
        </>
      ) : (
        <>
          <span className="crew-garderobe-kicker">
            {anzeige.art === "abholung"
              ? "Bügel holen"
              : anzeige.art === "haengt"
                ? "Aufgehängt an Bügel"
                : anzeige.art === "gerade"
                  ? "Gerade erst abgegeben"
                  : `Schon abgeholt${anzeige.zeitpunkt ? ` · ${uhr(anzeige.zeitpunkt)}` : ""}`}
          </span>
          <span className="crew-garderobe-nummer">{anzeige.nummer ?? "?"}</span>
          <span className="crew-garderobe-detail">
            {anzeige.name ?? "Ohne Namen"}
            {"offline" in anzeige && anzeige.offline ? " · ohne Netz, wird nachgereicht" : ""}
          </span>
        </>
      )}
      <span className="crew-garderobe-knoepfe">
        {anzeige.art === "gerade" ? (
          <button type="button" className="btn crew-garderobe-knopf" onClick={() => ausgeben(anzeige.id)} disabled={arbeitet}>
            Trotzdem ausgeben
          </button>
        ) : null}
        {(anzeige.art === "abholung" || anzeige.art === "haengt" || anzeige.art === "schon_abgeholt") && anzeige.id ? (
          <button type="button" className="btn crew-garderobe-knopf" data-leise onClick={() => zurueck(anzeige.id!)} disabled={arbeitet}>
            <i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" />
            Rückgängig
          </button>
        ) : null}
        <button type="button" className="btn crew-garderobe-knopf" onClick={weiter}>
          Weiter
        </button>
      </span>
    </div>
  );
}
