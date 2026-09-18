"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import jsQR from "jsqr";
import { Knopf } from "./Knopf";
import {
  gibJackeAus,
  gibMarkeAb,
  holeMarken,
  macheRueckgaengig,
  scanneMarke,
  type GarderobeScan,
  type MarkeInListe,
} from "@/app/aktionen/garderobe";
import type { GarderobeZustand } from "@/lib/typen";
import scan from "./EinlassScanner.module.css";
import css from "./GarderobeTresen.module.css";

type Event = { id: string; titel: string; wann: string };

/** Was gerade groß auf dem Bildschirm steht. */
type Anzeige =
  | { art: "leer" }
  | { art: "abgabe"; id: string; name: string | null; code: string; fehler?: string; offline?: boolean }
  | { art: "haengt"; id: string; name: string | null; nummer: string; offline?: boolean }
  | { art: "abholung"; id: string; name: string | null; nummer: string; offline?: boolean }
  | { art: "gerade"; id: string; name: string | null; nummer: string }
  | { art: "schon_abgeholt"; name?: string | null; nummer?: string; zeitpunkt?: string; id?: string }
  | { art: "fehler"; text: string; detail?: string };

type Auftrag =
  | { art: "abgeben"; id: string; nummer: string; zeit: number }
  | { art: "ausgeben"; id: string; zeit: number };

/** Dieselbe Marke wird gern zweimal hintereinander vor die Kamera gehalten. */
const SPERRE_MS = 2500;
/** Länger wartet am Tresen niemand — danach gilt es wie kein Netz. */
const FRIST_MS = 6000;
const TAKT_MS = 20_000;
/** Wie `garderobe_scan()`: kurz nach der Abgabe wird nicht ausgegeben. */
const GERADE_MS = 3 * 60 * 1000;

const SPEICHER_PUFFER = "lunar.garderobe.puffer";
const speicherListe = (eventId: string) => `lunar.garderobe.liste.${eventId}`;

async function pruefsumme(code: string): Promise<string> {
  const daten = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", daten);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function lies<T>(schluessel: string, standard: T): T {
  try {
    const roh = localStorage.getItem(schluessel);
    return roh ? (JSON.parse(roh) as T) : standard;
  } catch {
    return standard;
  }
}

function schreib(schluessel: string, wert: unknown) {
  try {
    localStorage.setItem(schluessel, JSON.stringify(wert));
  } catch {
    // Voller oder gesperrter Speicher: dann eben ohne Puffer weiter.
  }
}

/** Antwortet der Server nicht rechtzeitig, gilt das wie kein Netz. */
function mitFrist<T>(versprechen: Promise<T>): Promise<T> {
  return Promise.race([
    versprechen,
    new Promise<T>((_, nein) => setTimeout(() => nein(new Error("frist")), FRIST_MS)),
  ]);
}

const ZUSTAND_TEXT: Record<GarderobeZustand, string> = {
  offen: "Nicht abgegeben",
  haengt: "Hängt",
  abgeholt: "Abgeholt",
  storniert: "Storniert",
};

function uhrzeit(iso: string | number): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function GarderobeTresen({ events }: { events: Event[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const strom = useRef<MediaStream | null>(null);
  const laufend = useRef(false);
  const zuletzt = useRef<{ code: string; zeit: number } | null>(null);
  const modusRef = useRef<"scan" | "suche">("scan");
  // Wann dieses Gerät eine Marke aufgehängt hat — für "gerade abgegeben"
  // ohne Netz, wo die Liste die Uhrzeit nicht kennt.
  const lokaleAbgaben = useRef<Record<string, number>>({});

  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [modus, setModus] = useState<"scan" | "suche">("scan");
  const [laeuft, setLaeuft] = useState(false);
  const [anzeige, setAnzeigeZustand] = useState<Anzeige>({ art: "leer" });
  const anzeigeRef = useRef<Anzeige>(anzeige);
  const [nummer, setNummer] = useState("");
  const [arbeitet, setArbeitet] = useState(false);
  const [online, setOnline] = useState(true);
  const [liste, setListe] = useState<MarkeInListe[]>([]);
  const listeRef = useRef<MarkeInListe[]>([]);
  const [puffer, setPuffer] = useState<Auftrag[]>([]);
  const pufferRef = useRef<Auftrag[]>([]);
  const [konflikte, setKonflikte] = useState<string[]>([]);
  const [handeingabe, setHandeingabe] = useState(false);
  const [getippt, setGetippt] = useState("");
  const [suche, setSuche] = useState("");
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  /**
   * Setzt, was groß auf dem Bildschirm steht. In der Suche ist diese Anzeige
   * verdeckt — dort steht das Ergebnis als Zeile über der Liste.
   */
  const setAnzeige = useCallback((neu: Anzeige) => {
    anzeigeRef.current = neu;
    setAnzeigeZustand(neu);
    if (modusRef.current !== "suche") return;
    if (neu.art === "abholung") {
      setMeldung(`Ausgeben: Bügel ${neu.nummer}${neu.name ? ` · ${neu.name}` : ""}`);
    } else if (neu.art === "haengt") {
      setMeldung(`Aufgehängt: Bügel ${neu.nummer}${neu.name ? ` · ${neu.name}` : ""}`);
    } else if (neu.art === "fehler") {
      setMeldung(neu.text);
    }
  }, []);

  // --- Liste und Puffer: Zustand fürs Zeichnen, Ref für die Abläufe ---
  const setzeListe = useCallback(
    (neu: MarkeInListe[]) => {
      listeRef.current = neu;
      setListe(neu);
      schreib(speicherListe(eventId), neu);
    },
    [eventId],
  );

  const setzePuffer = useCallback((neu: Auftrag[]) => {
    pufferRef.current = neu;
    setPuffer(neu);
    schreib(SPEICHER_PUFFER, neu);
  }, []);

  const aendereMarke = useCallback(
    (id: string, aenderung: Partial<MarkeInListe>) => {
      setzeListe(listeRef.current.map((m) => (m.id === id ? { ...m, ...aenderung } : m)));
    },
    [setzeListe],
  );

  const name = useCallback(
    (id: string) => listeRef.current.find((m) => m.id === id)?.name ?? null,
    [],
  );

  // --- Netzzustand ---
  useEffect(() => {
    const setzen = () => setOnline(navigator.onLine);
    setzen();
    window.addEventListener("online", setzen);
    window.addEventListener("offline", setzen);
    return () => {
      window.removeEventListener("online", setzen);
      window.removeEventListener("offline", setzen);
    };
  }, []);

  // --- Gespeicherter Stand, sofort da — auch ohne Netz ---
  useEffect(() => {
    const gespeichert = lies<MarkeInListe[]>(speicherListe(eventId), []);
    listeRef.current = gespeichert;
    setListe(gespeichert);
    const p = lies<Auftrag[]>(SPEICHER_PUFFER, []);
    pufferRef.current = p;
    setPuffer(p);
    setAnzeige({ art: "leer" });
  }, [eventId, setAnzeige]);

  const ladeListe = useCallback(async () => {
    if (!eventId) return;
    const { ok, marken } = await holeMarken(eventId);
    if (!ok) return;
    // Was hier noch nicht nachgereicht ist, bleibt so, wie es am Tresen war.
    const offen = new Map(pufferRef.current.map((a) => [a.id, a]));
    setzeListe(
      marken.map((m) => {
        const a = offen.get(m.id);
        if (!a) return m;
        return a.art === "abgeben"
          ? { ...m, zustand: "haengt" as const, nummer: a.nummer }
          : { ...m, zustand: "abgeholt" as const };
      }),
    );
  }, [eventId, setzeListe]);

  // --- Gepuffertes nachreichen ---
  const nachreichen = useCallback(async () => {
    const offen = [...pufferRef.current];
    if (offen.length === 0) return;
    const uebrig: Auftrag[] = [];
    const neueKonflikte: string[] = [];

    for (const auftrag of offen) {
      try {
        if (auftrag.art === "abgeben") {
          const r = await mitFrist(gibMarkeAb(auftrag.id, auftrag.nummer));
          const wer = name(auftrag.id) ?? "Unbekannt";
          if (r.ergebnis === "nummer_belegt") {
            neueKonflikte.push(
              `Bügel ${auftrag.nummer} war doppelt vergeben (${wer}, ${uhrzeit(auftrag.zeit)}). Bitte nachsehen.`,
            );
          } else if (r.ergebnis === "schon_abgegeben" && r.nummer && r.nummer !== auftrag.nummer) {
            neueKonflikte.push(
              `${wer}: im System an Bügel ${r.nummer}, hier eingetippt ${auftrag.nummer}.`,
            );
          }
        } else {
          await mitFrist(gibJackeAus(auftrag.id));
        }
      } catch {
        uebrig.push(auftrag);
      }
    }

    // Was während des Nachreichens dazukam, geht nicht verloren.
    const neu = pufferRef.current.filter((a) => !offen.includes(a));
    setzePuffer([...uebrig, ...neu]);
    if (neueKonflikte.length > 0) setKonflikte((k) => [...neueKonflikte, ...k]);
    if (uebrig.length === 0) await ladeListe();
  }, [ladeListe, name, setzePuffer]);

  // --- Takt: nachreichen, dann den Stand der anderen Geräte holen ---
  useEffect(() => {
    if (!eventId) return;
    let aus = false;
    const lauf = async () => {
      if (aus || !navigator.onLine) return;
      await nachreichen();
      await ladeListe();
    };
    void lauf();
    const takt = setInterval(lauf, TAKT_MS);
    return () => {
      aus = true;
      clearInterval(takt);
    };
  }, [eventId, online, ladeListe, nachreichen]);

  // --- Ergebnis eines Scans anzeigen ---
  const zeigeScan = useCallback(
    (e: GarderobeScan, code: string) => {
      switch (e.ergebnis) {
        case "abgabe":
          setNummer("");
          setAnzeige({ art: "abgabe", id: e.id!, name: e.name ?? null, code });
          return;
        case "abholung":
          aendereMarke(e.id!, { zustand: "abgeholt" });
          setAnzeige({ art: "abholung", id: e.id!, name: e.name ?? null, nummer: e.nummer ?? "?" });
          return;
        case "gerade_abgegeben":
          setAnzeige({ art: "gerade", id: e.id!, name: e.name ?? null, nummer: e.nummer ?? "?" });
          return;
        case "schon_abgeholt":
          if (e.id) aendereMarke(e.id, { zustand: "abgeholt" });
          setAnzeige({
            art: "schon_abgeholt",
            id: e.id,
            name: e.name,
            nummer: e.nummer,
            zeitpunkt: e.zeitpunkt,
          });
          return;
        case "storniert":
          setAnzeige({ art: "fehler", text: "Storniert", detail: e.name ?? undefined });
          return;
        case "anderes_event":
          setAnzeige({ art: "fehler", text: "Anderes Event", detail: e.event });
          return;
        case "ticket":
          setAnzeige({
            art: "fehler",
            text: "Das ist ein Ticket",
            detail: "Die Garderobenmarke steht auf der Ticketseite unter den Tickets.",
          });
          return;
        case "keine_berechtigung":
          setAnzeige({ art: "fehler", text: "Nicht berechtigt" });
          return;
        default:
          setAnzeige({ art: "fehler", text: "Unbekannt" });
      }
    },
    [aendereMarke, setAnzeige],
  );

  // --- Ohne Netz: aus der gespeicherten Liste entscheiden ---
  const scanOhneNetz = useCallback(
    async (code: string) => {
      if (!code.startsWith("G-")) {
        setAnzeige({ art: "fehler", text: "Keine Garderobenmarke", detail: "Garderobenmarken beginnen mit „G-“." });
        return;
      }
      const summe = await pruefsumme(code);
      const marke = listeRef.current.find((m) => m.summe === summe);
      if (!marke) {
        setAnzeige({
          art: "fehler",
          text: "Unbekannt",
          detail: "Ohne Netz — nicht in der gespeicherten Liste. Name suchen oder später nochmal scannen.",
        });
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
        if (seit && Date.now() - seit < GERADE_MS) {
          setAnzeige({ art: "gerade", id: marke.id, name: marke.name, nummer: marke.nummer ?? "?" });
          return;
        }
        setzePuffer([...pufferRef.current, { art: "ausgeben", id: marke.id, zeit: Date.now() }]);
        aendereMarke(marke.id, { zustand: "abgeholt" });
        setAnzeige({ art: "abholung", id: marke.id, name: marke.name, nummer: marke.nummer ?? "?", offline: true });
      }
    },
    [aendereMarke, setAnzeige, setzePuffer],
  );

  // --- Einen Code verarbeiten ---
  const verarbeite = useCallback(
    async (roh: string) => {
      const code = roh.trim().toUpperCase();
      const jetzt = Date.now();
      if (zuletzt.current && zuletzt.current.code === code && jetzt - zuletzt.current.zeit < SPERRE_MS) {
        return;
      }
      // Wartet diese Marke gerade auf ihre Bügelnummer, ändert ein zweiter
      // Scan nichts — erst tippen, dann weiter.
      const jetztZu = anzeigeRef.current;
      if (jetztZu.art === "abgabe" && jetztZu.code === code) return;
      zuletzt.current = { code, zeit: jetzt };
      if (navigator.vibrate) navigator.vibrate(40);
      setMeldung(null);

      try {
        const e = await mitFrist(scanneMarke(code, eventId));
        setOnline(true);
        zeigeScan(e, code);
      } catch {
        await scanOhneNetz(code);
      }
    },
    [eventId, scanOhneNetz, zeigeScan],
  );

  // --- Aufhängen ---
  async function haengeAuf(id: string, eingabe: string, code?: string) {
    const nr = eingabe.trim().toUpperCase();
    if (nr.length < 1 || nr.length > 12) return;
    setArbeitet(true);
    try {
      const r = await mitFrist(gibMarkeAb(id, nr));
      if (r.ergebnis === "ok") {
        lokaleAbgaben.current[id] = Date.now();
        aendereMarke(id, { zustand: "haengt", nummer: nr });
        setAnzeige({ art: "haengt", id, name: r.name ?? name(id), nummer: nr });
        setAufgeklappt(null);
      } else if (r.ergebnis === "nummer_belegt") {
        const fehler = `Bügel ${nr} ist schon belegt.`;
        if (code) setAnzeige({ art: "abgabe", id, name: name(id), code, fehler });
        else setMeldung(fehler);
      } else if (r.ergebnis === "schon_abgegeben") {
        aendereMarke(id, { zustand: r.zustand ?? "haengt", nummer: r.nummer ?? null });
        setAnzeige({ art: "haengt", id, name: name(id), nummer: r.nummer ?? "?" });
      } else {
        setAnzeige({
          art: "fehler",
          text: r.ergebnis === "storniert" ? "Storniert" : r.ergebnis === "keine_berechtigung" ? "Nicht berechtigt" : "Unbekannt",
        });
      }
    } catch {
      // Ohne Netz: Bügel nur gegen die eigene Liste prüfen, nachreichen.
      if (listeRef.current.some((m) => m.zustand === "haengt" && m.nummer === nr && m.id !== id)) {
        const fehler = `Bügel ${nr} ist laut Liste schon belegt.`;
        if (code) setAnzeige({ art: "abgabe", id, name: name(id), code, fehler, offline: true });
        else setMeldung(fehler);
      } else {
        lokaleAbgaben.current[id] = Date.now();
        setzePuffer([...pufferRef.current, { art: "abgeben", id, nummer: nr, zeit: Date.now() }]);
        aendereMarke(id, { zustand: "haengt", nummer: nr });
        setAnzeige({ art: "haengt", id, name: name(id), nummer: nr, offline: true });
        setAufgeklappt(null);
      }
    } finally {
      setArbeitet(false);
      setNummer("");
    }
  }

  // --- Ausgeben ohne Scan (Suche, "trotzdem ausgeben") ---
  async function gibAus(id: string) {
    setArbeitet(true);
    try {
      const r = await mitFrist(gibJackeAus(id));
      if (r.ergebnis === "abholung" || r.ergebnis === "schon_abgeholt") {
        aendereMarke(id, { zustand: "abgeholt" });
        setAnzeige(
          r.ergebnis === "abholung"
            ? { art: "abholung", id, name: r.name ?? name(id), nummer: r.nummer ?? "?" }
            : { art: "schon_abgeholt", id, name: name(id), nummer: r.nummer, zeitpunkt: r.zeitpunkt },
        );
      } else {
        setAnzeige({ art: "fehler", text: r.ergebnis === "nicht_abgegeben" ? "Nicht abgegeben" : "Geht nicht" });
      }
    } catch {
      const marke = listeRef.current.find((m) => m.id === id);
      setzePuffer([...pufferRef.current, { art: "ausgeben", id, zeit: Date.now() }]);
      aendereMarke(id, { zustand: "abgeholt" });
      setAnzeige({ art: "abholung", id, name: marke?.name ?? null, nummer: marke?.nummer ?? "?", offline: true });
    } finally {
      setArbeitet(false);
      setAufgeklappt(null);
    }
  }


  // --- Einen Schritt zurück: nur mit Netz ---
  async function rueckgaengig(id: string) {
    setArbeitet(true);
    try {
      await nachreichen();
      const r = await mitFrist(macheRueckgaengig(id));
      if (r.ergebnis === "ok") {
        aendereMarke(id, { zustand: r.zustand ?? "offen", nummer: r.nummer ?? null });
        setMeldung(r.zustand === "haengt" ? `Hängt wieder an Bügel ${r.nummer}.` : "Abgabe zurückgenommen.");
        setAnzeige({ art: "leer" });
      } else if (r.ergebnis === "nummer_belegt") {
        setMeldung(`Bügel ${r.nummer} ist inzwischen neu vergeben — bitte von Hand klären.`);
      } else {
        setMeldung("Da gibt es nichts zurückzunehmen.");
      }
    } catch {
      setMeldung("Rückgängig geht nur mit Netz.");
    } finally {
      setArbeitet(false);
    }
  }

  // --- Kamera (wie beim Einlass) ---
  const suchen = useCallback(() => {
    const v = video.current;
    const c = leinwand.current;
    if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) {
      if (laufend.current) requestAnimationFrame(suchen);
      return;
    }
    const kante = Math.min(v.videoWidth, v.videoHeight) * 0.7;
    c.width = kante;
    c.height = kante;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(v, (v.videoWidth - kante) / 2, (v.videoHeight - kante) / 2, kante, kante, 0, 0, kante, kante);
    const bild = ctx.getImageData(0, 0, kante, kante);
    const treffer = jsQR(bild.data, bild.width, bild.height, { inversionAttempts: "dontInvert" });
    if (treffer?.data && modusRef.current === "scan") void verarbeite(treffer.data);
    if (laufend.current) requestAnimationFrame(suchen);
  }, [verarbeite]);

  async function starten() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      strom.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setLaeuft(true);
      laufend.current = true;
      requestAnimationFrame(suchen);
    } catch {
      setAnzeige({ art: "fehler", text: "Kamera nicht freigegeben", detail: "Codes lassen sich unten auch eintippen." });
    }
  }

  useEffect(() => {
    return () => {
      laufend.current = false;
      strom.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- Zahlen im Kopf ---
  const stand = useMemo(() => {
    let haengt = 0;
    let abgeholt = 0;
    let gesamt = 0;
    for (const m of liste) {
      if (m.zustand === "storniert") continue;
      gesamt++;
      if (m.zustand === "haengt") haengt++;
      if (m.zustand === "abgeholt") abgeholt++;
    }
    return { haengt, abgeholt, gesamt };
  }, [liste]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (q.length < 2 && !/^\d+$/.test(q)) return [];
    return liste
      .filter(
        (m) =>
          (m.name ?? "").toLowerCase().includes(q) ||
          m.bestellnummer.toLowerCase().includes(q) ||
          (m.nummer ?? "").toLowerCase() === q,
      )
      .slice(0, 30);
  }, [liste, suche]);

  const farbe =
    anzeige.art === "abholung" || anzeige.art === "haengt"
      ? scan.gueltig
      : anzeige.art === "gerade" || anzeige.art === "schon_abgeholt"
        ? scan.schon_entwertet
        : anzeige.art === "fehler"
          ? scan.unbekannt
          : anzeige.art === "abgabe"
            ? css.abgabe
            : scan.leer;

  return (
    <div className={scan.rahmen}>
      <header className={scan.kopf}>
        <select
          className={scan.eventwahl}
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          aria-label="Event"
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.titel} · {e.wann}
            </option>
          ))}
        </select>
        <div className={scan.zaehler}>
          <span className={scan.zaehlerWert}>{stand.haengt}</span>
          <span className={scan.zaehlerName}>hängen</span>
        </div>
      </header>

      <div className={scan.modus} role="tablist" aria-label="Garderobe">
        {(
          [
            ["scan", "Scannen"],
            ["suche", "Name suchen"],
          ] as const
        ).map(([wert, beschriftung]) => (
          <button
            key={wert}
            type="button"
            role="tab"
            aria-selected={modus === wert}
            className={`${scan.modusKnopf} ${modus === wert ? scan.modusAktiv : ""}`}
            onClick={() => {
              modusRef.current = wert;
              setModus(wert);
            }}
          >
            {beschriftung}
          </button>
        ))}
      </div>

      {konflikte.length > 0 ? (
        <div className={css.konflikte} role="alert">
          <strong>Beim Nachtragen aufgefallen</strong>
          <ul>
            {konflikte.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
          <button type="button" className={css.leise} onClick={() => setKonflikte([])}>
            Gesehen
          </button>
        </div>
      ) : null}

      {meldung ? (
        <p className={css.meldung} role="status">
          {meldung}
        </p>
      ) : null}

      {modus === "suche" ? (
        <div className={scan.liste}>
          <div className={scan.listeKopf}>
            <input
              className={scan.codefeld}
              style={{ textTransform: "none", letterSpacing: 0 }}
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Name, Bestellnummer oder Bügel …"
              autoComplete="off"
              spellCheck={false}
              aria-label="Suchen"
            />
            <span className={scan.listeSumme}>
              {stand.gesamt} gebucht · {stand.haengt} hängen · {stand.abgeholt} abgeholt
            </span>
          </div>
          <ul className={scan.gaeste}>
            {treffer.map((m) => (
              <li key={m.id} className={scan.gast}>
                <button
                  type="button"
                  className={scan.gastZeile}
                  aria-expanded={aufgeklappt === m.id}
                  onClick={() => {
                    setNummer("");
                    setAufgeklappt((a) => (a === m.id ? null : m.id));
                  }}
                >
                  <span className={scan.gastName}>
                    <strong>{m.name ?? "Ohne Namen"}</strong>
                    <span className={scan.listeSumme}>{m.bestellnummer}</span>
                  </span>
                  <span className={`${scan.gastStand} ${m.zustand === "haengt" ? scan.gastFertig : ""}`}>
                    {m.zustand === "haengt" ? `Bügel ${m.nummer}` : ZUSTAND_TEXT[m.zustand]}
                  </span>
                </button>
                {aufgeklappt === m.id ? (
                  <div className={scan.gastAktionen}>
                    {m.zustand === "offen" ? (
                      <form
                        className={css.nummerForm}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void haengeAuf(m.id, nummer);
                        }}
                      >
                        <input
                          className={css.nummerFeld}
                          value={nummer}
                          onChange={(e) => setNummer(e.target.value)}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="Bügel"
                          aria-label={`Bügelnummer für ${m.name ?? "diese Marke"}`}
                          autoFocus
                        />
                        <button type="submit" className={scan.gastKnopf} disabled={arbeitet || !nummer.trim()}>
                          Aufhängen
                        </button>
                      </form>
                    ) : m.zustand === "haengt" ? (
                      <button type="button" className={scan.gastKnopf} disabled={arbeitet} onClick={() => void gibAus(m.id)}>
                        Ausgeben · Bügel {m.nummer}
                      </button>
                    ) : m.zustand === "abgeholt" ? (
                      <button
                        type="button"
                        className={`${scan.gastKnopf} ${css.zurueck}`}
                        disabled={arbeitet}
                        onClick={() => void rueckgaengig(m.id)}
                      >
                        Rückgängig
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {suche.trim() && treffer.length === 0 ? (
            <p className={css.leer}>Nichts gefunden.</p>
          ) : null}
        </div>
      ) : null}

      <div className={scan.buehne} hidden={modus !== "scan"}>
        <video ref={video} className={scan.video} playsInline muted />
        <canvas ref={leinwand} hidden />
        {laeuft ? (
          <div className={scan.zielrahmen} aria-hidden="true">
            <span />
          </div>
        ) : (
          <button type="button" className={scan.startknopf} onClick={starten}>
            <strong>Kamera starten</strong>
            <span className={scan.startHinweis}>
              Garderobenmarke in den Rahmen halten. Ohne Kamera: unten den Code
              eintippen oder nach dem Namen suchen.
            </span>
          </button>
        )}
      </div>

      <div className={`${scan.ergebnis} ${farbe}`} aria-live="assertive" hidden={modus !== "scan"}>
        {anzeige.art === "leer" ? (
          <p className={scan.wartet}>
            Abgabe: scannen, Bügelnummer eintippen. Abholung: scannen — die
            Nummer steht dann groß hier.
          </p>
        ) : anzeige.art === "abgabe" ? (
          <>
            <span className={scan.urteil}>Abgabe</span>
            <span className={scan.detail}>{anzeige.name ?? "Ohne Namen"}</span>
            <form
              className={css.nummerForm}
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void haengeAuf(anzeige.id, nummer, anzeige.code);
              }}
            >
              <input
                className={css.nummerFeld}
                value={nummer}
                onChange={(e) => setNummer(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Bügel"
                aria-label="Bügelnummer"
                autoFocus
              />
              <button type="submit" className={scan.gastKnopf} disabled={arbeitet || !nummer.trim()}>
                Aufhängen
              </button>
            </form>
            {anzeige.fehler ? <span className={css.fehler}>{anzeige.fehler}</span> : null}
            {anzeige.offline ? (
              <span className={scan.nebensache}>Ohne Netz — wird nachgetragen.</span>
            ) : null}
          </>
        ) : anzeige.art === "haengt" ? (
          <>
            <span className={scan.urteil}>Aufgehängt</span>
            <span className={css.nummerGross}>{anzeige.nummer}</span>
            <span className={scan.detail}>{anzeige.name ?? ""}</span>
            {anzeige.offline ? (
              <span className={scan.nebensache}>Ohne Netz — wird nachgetragen.</span>
            ) : (
              <button type="button" className={css.leise} onClick={() => void rueckgaengig(anzeige.id)}>
                Rückgängig
              </button>
            )}
          </>
        ) : anzeige.art === "abholung" ? (
          <>
            <span className={scan.urteil}>Ausgeben</span>
            <span className={css.nummerGross}>{anzeige.nummer}</span>
            <span className={scan.detail}>{anzeige.name ?? ""}</span>
            {anzeige.offline ? (
              <span className={scan.nebensache}>Ohne Netz — wird nachgetragen.</span>
            ) : (
              <button type="button" className={css.leise} onClick={() => void rueckgaengig(anzeige.id)}>
                Rückgängig
              </button>
            )}
          </>
        ) : anzeige.art === "gerade" ? (
          <>
            <span className={scan.urteil}>Gerade abgegeben</span>
            <span className={css.nummerGross}>{anzeige.nummer}</span>
            <span className={scan.detail}>{anzeige.name ?? ""}</span>
            <Knopf stil="hell" groesse="klein" onClick={() => void gibAus(anzeige.id)} disabled={arbeitet}>
              Trotzdem ausgeben
            </Knopf>
          </>
        ) : anzeige.art === "schon_abgeholt" ? (
          <>
            <span className={scan.urteil}>Schon abgeholt</span>
            {anzeige.nummer ? <span className={css.nummerGross}>{anzeige.nummer}</span> : null}
            <span className={scan.detail}>
              {[anzeige.name, anzeige.zeitpunkt ? `um ${uhrzeit(anzeige.zeitpunkt)}` : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {anzeige.id ? (
              <button type="button" className={css.leise} onClick={() => void rueckgaengig(anzeige.id!)}>
                Rückgängig
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className={scan.urteil}>{anzeige.text}</span>
            {anzeige.detail ? <span className={scan.detail}>{anzeige.detail}</span> : null}
          </>
        )}
      </div>

      {handeingabe && modus === "scan" ? (
        <form
          className={scan.eingabezeile}
          onSubmit={(e) => {
            e.preventDefault();
            if (getippt.trim()) {
              zuletzt.current = null;
              void verarbeite(getippt);
              setGetippt("");
            }
          }}
        >
          <input
            className={scan.codefeld}
            value={getippt}
            onChange={(e) => setGetippt(e.target.value)}
            placeholder="G-…"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <Knopf type="submit" stil="hell" groesse="klein">
            Prüfen
          </Knopf>
        </form>
      ) : null}

      <footer className={scan.fussleiste}>
        <span className={scan.netz}>
          <span className={`${scan.punkt} ${online ? scan.online : scan.offline}`} />
          {online
            ? puffer.length > 0
              ? `${puffer.length} werden nachgetragen`
              : "Verbunden"
            : `Ohne Netz · ${liste.length} Marken bekannt`}
        </span>
        <button type="button" className={scan.handeingabe} onClick={() => setHandeingabe((h) => !h)}>
          {handeingabe ? "Eingabe schließen" : "Code eintippen"}
        </button>
      </footer>
    </div>
  );
}
