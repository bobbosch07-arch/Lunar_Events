"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { browserClient } from "@/lib/supabase/client";
import {
  crewPruefen,
  crewReinlassen,
  crewRueckgaengig,
  crewStand,
  crewTrageNach,
  holeListe,
  pruefsumme,
  type CrewAktion,
  type CrewErgebnis,
  type EinlassListe,
} from "@/lib/einlass";
import { ABLAGE, lies, schreib } from "@/lib/crew/ablage";

export type CrewEvent = { id: string; titel: string; wann: string; entwurf?: boolean };

/**
 * Was die Urteilsfläche zeigt. `entschieden` ist der Zustand nach einem
 * Tipp auf Reinlassen oder Abweisen — mit Rückgängig, bis der nächste Code
 * kommt.
 */
type Anzeige =
  | { art: "bereit" }
  | { art: "urteil"; code: string; wert: CrewErgebnis; offline: boolean }
  | { art: "entschieden"; code: string; wert: CrewErgebnis; wie: "rein" | "weg"; offline: boolean }
  /** Nur prüfen braucht die Datenbank. */
  | { art: "verbindung" };

/** In dieser Zeit wird derselbe Code nicht noch einmal gelesen. */
const SPERRE_MS = 2500;
/**
 * Der Code, dessen Urteil gerade angezeigt wird, bleibt so lange stumm: Wer
 * nach „Reinlassen“ das Handy nicht sofort wegdreht, sähe sonst „Schon drin“
 * und verlöre den Knopf Rückgängig.
 */
const ANGEZEIGT_SPERRE_MS = 20_000;
const AUFFRISCHEN_MS = 5 * 60 * 1000;
const NACHTRAGEN_MS = 20 * 1000;
const STAND_MS = 60 * 1000;

type Offen = CrewAktion & { id: string };

function zeitText(iso?: string) {
  return iso
    ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : "";
}

function datumText(iso?: string) {
  return iso
    ? new Date(iso).toLocaleString("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

/**
 * Der Scanner der Crew-App (Skin-Vorlage, Lunar-Ablauf: prüfen, Ausweis,
 * entscheiden).
 *
 * Wie im alten Scanner (0048) steht alles, was die Kamera-Schleife und die
 * Entscheidungen brauchen, in Refs — die Schleife läuft vom Start der Kamera
 * an mit derselben Funktion und sähe sonst veralteten Zustand.
 */
export function CrewScanner({
  events,
  eventId,
  setEventId,
  abmelden,
  aktiv = true,
}: {
  events: CrewEvent[];
  eventId: string;
  setEventId: (id: string) => void;
  abmelden: () => void;
  /** Sichtbar? Auf einem anderen Tab läuft die Kamera weiter, liest aber nichts. */
  aktiv?: boolean;
}) {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const holeDb = () => (db.current ??= browserClient());

  const video = useRef<HTMLVideoElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const strom = useRef<MediaStream | null>(null);
  const laufend = useRef(false);
  const zuletzt = useRef<{ code: string; zeit: number } | null>(null);
  const flaeche = useRef<HTMLDivElement>(null);
  const zeile = useRef<HTMLSpanElement>(null);
  const funken = useRef<HTMLSpanElement>(null);

  const eventRef = useRef(eventId);
  const aktivRef = useRef(aktiv);
  useEffect(() => {
    aktivRef.current = aktiv;
  }, [aktiv]);
  const [nurPruefen, setNurPruefen] = useState(false);
  const pruefenRef = useRef(false);
  const modusRef = useRef<"automatisch" | "entscheiden">("entscheiden");

  const [anzeige, setAnzeigeState] = useState<Anzeige>({ art: "bereit" });
  const anzeigeRef = useRef<Anzeige>({ art: "bereit" });
  const angezeigtSeit = useRef(0);
  const setAnzeige = (a: Anzeige) => {
    anzeigeRef.current = a;
    angezeigtSeit.current = Date.now();
    setAnzeigeState(a);
  };

  const [laeuft, setLaeuft] = useState(false);
  const [kameraFehler, setKameraFehler] = useState(false);
  const [online, setOnline] = useState(true);
  const [schwach, setSchwach] = useState(false);
  const [anmeldungWeg, setAnmeldungWeg] = useState(false);
  const [doppelt, setDoppelt] = useState<string[]>([]);
  const [handeingabe, setHandeingabe] = useState(false);
  const [getippt, setGetippt] = useState("");
  const [beschaeftigt, setBeschaeftigtState] = useState(false);
  // Gegen Doppeltippen, auch aus der Kamera-Schleife heraus lesbar.
  const beschaeftigtRef = useRef(false);
  const setBeschaeftigt = (b: boolean) => {
    beschaeftigtRef.current = b;
    setBeschaeftigtState(b);
  };

  // Belegung: Stand des Servers plus das, was dieses Gerät noch nachträgt.
  const [drinServer, setDrinServer] = useState<number | null>(null);
  const [kapazitaet, setKapazitaet] = useState<number | null>(null);

  const offenRef = useRef<Offen[]>([]);
  const [offen, setOffenState] = useState<Offen[]>([]);
  const nachtragenLaeuft = useRef(false);

  const gueltigRef = useRef<Set<string>>(new Set());
  const drinRef = useRef<Set<string>>(new Set());
  const namenRef = useRef<Record<string, string>>({});
  const [liste, setListe] = useState<{ anzahl: number; stand: number } | null>(null);

  function setOffen(neu: Offen[]) {
    offenRef.current = neu;
    setOffenState(neu);
    void schreib(ABLAGE.aktionen, neu);
  }

  function merkeDrin(summe: string, drin: boolean) {
    if (drin) drinRef.current.add(summe);
    else drinRef.current.delete(summe);
    void schreib(ABLAGE.drin(eventRef.current), [...drinRef.current]);
  }

  function setzeStand(drin: number | undefined | null) {
    if (typeof drin === "number") {
      setDrinServer(drin);
      void schreib(ABLAGE.stand(eventRef.current), { drin, kapazitaet: kapazitaetRef.current });
    }
  }
  const kapazitaetRef = useRef<number | null>(null);

  // --- Netz ---
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

  // --- Offene Entscheidungen vom letzten Mal ---
  useEffect(() => {
    void lies<Offen[]>(ABLAGE.aktionen, []).then((alt) => {
      // Was in der Zwischenzeit dazukam, nicht überschreiben.
      if (offenRef.current.length === 0) {
        offenRef.current = alt;
        setOffenState(alt);
      }
    });
  }, []);

  // --- Je Event: Liste, eigenes "drin", letzter Stand aus der Ablage ---
  // Beim Eventwechsel baut CrewApp den Scanner neu auf (key), deshalb muss
  // hier nichts zurückgesetzt werden.
  useEffect(() => {
    eventRef.current = eventId;
    let aktiv = true;
    void Promise.all([
      lies<(EinlassListe & { stand: number }) | null>(ABLAGE.liste(eventId), null),
      lies<string[]>(ABLAGE.drin(eventId), []),
      lies<{ drin: number; kapazitaet: number | null } | null>(ABLAGE.stand(eventId), null),
    ]).then(([l, eigene, stand]) => {
      if (!aktiv || eventRef.current !== eventId) return;
      if (l) {
        gueltigRef.current = new Set(l.gueltig);
        namenRef.current = l.namen;
        setListe({ anzahl: l.gueltig.length + l.drin.length, stand: l.stand });
      }
      drinRef.current = new Set([...(l?.drin ?? []), ...eigene]);
      if (stand) {
        setDrinServer((d) => d ?? stand.drin);
        kapazitaetRef.current = stand.kapazitaet;
        setKapazitaet((k) => k ?? stand.kapazitaet);
      }
    });
    return () => {
      aktiv = false;
    };
  }, [eventId]);

  // Liste für den Betrieb ohne Netz, alle fünf Minuten neu.
  useEffect(() => {
    if (!eventId || !online) return;
    let aktiv = true;
    const holen = async () => {
      const l = await holeListe(holeDb(), eventId);
      if (!l || !aktiv || eventRef.current !== eventId) return;
      const stand = Date.now();
      gueltigRef.current = new Set(l.gueltig);
      const eigene = await lies<string[]>(ABLAGE.drin(eventId), []);
      // Was dieses Gerät eingelassen hat und noch nachträgt, bleibt "drin";
      // was es zurückgenommen hat, steht in der Liste schon wieder gültig.
      const nochOffen = new Set(
        await Promise.all(
          offenRef.current.filter((o) => o.eventId === eventId && o.aktion === "rein").map((o) => pruefsumme(o.code)),
        ),
      );
      drinRef.current = new Set([...l.drin, ...eigene.filter((s) => nochOffen.has(s) || l.drin.includes(s))]);
      namenRef.current = l.namen;
      setListe({ anzahl: l.gueltig.length + l.drin.length, stand });
      void schreib(ABLAGE.liste(eventId), { ...l, stand });
    };
    void holen();
    const takt = setInterval(() => void holen(), AUFFRISCHEN_MS);
    return () => {
      aktiv = false;
      clearInterval(takt);
    };
  }, [eventId, online]);

  // Stand und Kapazität, dazu live über Realtime.
  useEffect(() => {
    if (!eventId || !online) return;
    let aktiv = true;
    const holen = async () => {
      const s = await crewStand(holeDb(), eventId);
      if (!s || !aktiv || eventRef.current !== eventId) return;
      if (s.ergebnis === "keine_berechtigung") {
        setAnmeldungWeg(true);
        return;
      }
      modusRef.current = s.modus ?? "entscheiden";
      kapazitaetRef.current = s.kapazitaet ?? null;
      setKapazitaet(s.kapazitaet ?? null);
      setzeStand(s.drin);
    };
    void holen();
    const takt = setInterval(() => void holen(), STAND_MS);
    const kanal = holeDb()
      .channel(`einlass-stand-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einlass_stand", filter: `event_id=eq.${eventId}` },
        (nachricht) => {
          const zeile = nachricht.new as { drin?: number } | undefined;
          if (aktiv && eventRef.current === eventId) setzeStand(zeile?.drin);
        },
      )
      .subscribe();
    return () => {
      aktiv = false;
      clearInterval(takt);
      void holeDb().removeChannel(kanal);
    };
  }, [eventId, online]);

  // --- Nachtragen ---
  const nachtragen = useCallback(async () => {
    if (nachtragenLaeuft.current || !navigator.onLine || offenRef.current.length === 0) return;
    nachtragenLaeuft.current = true;
    try {
      const teil = offenRef.current.slice(0, 400);
      const gruppen = new Map<string, Offen[]>();
      for (const o of teil) gruppen.set(o.eventId, [...(gruppen.get(o.eventId) ?? []), o]);
      const erledigt = new Set<string>();
      for (const [ev, gruppe] of gruppen) {
        const antwort = await crewTrageNach(holeDb(), gruppe, ev);
        if (!antwort) break;
        setSchwach(false);
        if (antwort.ergebnis === "keine_berechtigung") {
          setAnmeldungWeg(true);
          break;
        }
        gruppe.forEach((o) => erledigt.add(o.id));
        const zweimal = (antwort.liste ?? [])
          .filter((a) => a.aktion === "rein" && a.ergebnis === "schon_entwertet" && !a.eigenes)
          .map((a) => a.gast ?? a.code);
        if (zweimal.length > 0) setDoppelt((d) => [...d, ...zweimal]);
        if (ev === eventRef.current) setzeStand(antwort.drin);
      }
      if (erledigt.size > 0) setOffen(offenRef.current.filter((o) => !erledigt.has(o.id)));
    } finally {
      nachtragenLaeuft.current = false;
    }
  }, []);

  useEffect(() => {
    if (!online) return;
    void nachtragen();
    const takt = setInterval(() => void nachtragen(), NACHTRAGEN_MS);
    return () => clearInterval(takt);
  }, [online, nachtragen]);

  function merkeAktion(code: string, aktion: Offen["aktion"]) {
    const ev = eventRef.current;
    // Rückgängig auf ein noch nicht nachgetragenes Reinlassen: beides fällt weg.
    if (aktion === "zurueck") {
      const i = offenRef.current.findLastIndex((o) => o.code === code && o.eventId === ev);
      if (i >= 0 && offenRef.current[i].aktion === "rein") {
        setOffen(offenRef.current.filter((_, j) => j !== i));
        return;
      }
    }
    setOffen([
      ...offenRef.current,
      { id: crypto.randomUUID(), code, aktion, zeit: Date.now(), eventId: ev },
    ]);
  }

  // --- Rückmeldung ---
  function feiern() {
    try {
      navigator.vibrate?.(40);
    } catch {
      // iPhone kennt es nicht.
    }
    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fl = flaeche.current;
    const zl = zeile.current;
    const bx = funken.current;
    if (ruhig) {
      zl?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      return;
    }
    fl?.animate([{ filter: "brightness(1.35)" }, { filter: "none" }], { duration: 320, easing: "ease-out" });
    zl?.animate([{ transform: "translateY(10px)", opacity: 0.4 }, { transform: "none", opacity: 1 }], {
      duration: 260,
      easing: "cubic-bezier(.16,1,.3,1)",
    });
    if (!bx) return;
    const farben = ["#ff8fd6", "#ffe14a", "#f7f0ff"];
    for (let i = 0; i < 9; i++) {
      const el = document.createElement("span");
      const w = 12 + Math.random() * 20;
      el.className = "crew-funke";
      el.style.width = `${w}px`;
      el.style.height = `${w}px`;
      el.style.background = farben[i % 3];
      bx.appendChild(el);
      const dx = 30 + Math.random() * 120;
      const dy = -70 + Math.random() * 110;
      const r = -180 + Math.random() * 360;
      el.animate(
        [
          { transform: "translate(0,0) rotate(0) scale(.4)", opacity: 1 },
          { transform: `translate(${dx}px,${dy}px) rotate(${r}deg) scale(1)`, opacity: 0 },
        ],
        { duration: 520 + Math.random() * 200, delay: i * 18, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" },
      ).onfinish = () => el.remove();
    }
  }

  function anhalten() {
    try {
      navigator.vibrate?.([90, 60, 90]);
    } catch {
      // egal
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    zeile.current?.animate(
      [
        { transform: "none" },
        { transform: "translateX(-10px)" },
        { transform: "translateX(9px)" },
        { transform: "translateX(-6px)" },
        { transform: "translateX(4px)" },
        { transform: "none" },
      ],
      { duration: 340, easing: "ease-out" },
    );
  }

  // --- Reinlassen, Abweisen, Rückgängig ---
  async function reinlassen(code: string, vorher: CrewErgebnis, offline: boolean) {
    if (beschaeftigtRef.current) return;
    const summe = await pruefsumme(code);
    if (!offline && navigator.onLine) {
      setBeschaeftigt(true);
      const antwort = await crewReinlassen(holeDb(), code, eventRef.current);
      setBeschaeftigt(false);
      if (antwort) {
        setSchwach(false);
        setzeStand(antwort.drin);
        if (antwort.ergebnis === "drin") {
          merkeDrin(summe, true);
          setAnzeige({ art: "entschieden", code, wert: { ...vorher, ...antwort }, wie: "rein", offline: false });
          feiern();
        } else {
          if (antwort.ergebnis === "keine_berechtigung") setAnmeldungWeg(true);
          if (antwort.ergebnis === "schon_entwertet") merkeDrin(summe, true);
          setAnzeige({ art: "urteil", code, wert: antwort, offline: false });
          anhalten();
        }
        return;
      }
      setSchwach(true);
    }
    // Ohne Antwort: merken und nachtragen.
    merkeDrin(summe, true);
    merkeAktion(code, "rein");
    setAnzeige({ art: "entschieden", code, wert: vorher, wie: "rein", offline: true });
    feiern();
  }

  async function rueckgaengig() {
    const a = anzeigeRef.current;
    if (a.art !== "entschieden" || beschaeftigtRef.current) return;
    const vorher: CrewErgebnis = { ...a.wert, ergebnis: "gueltig" };
    if (a.wie === "weg") {
      setAnzeige({ art: "urteil", code: a.code, wert: vorher, offline: a.offline });
      return;
    }
    const summe = await pruefsumme(a.code);
    const nochOffen = offenRef.current.some((o) => o.code === a.code && o.eventId === eventRef.current && o.aktion === "rein");
    if (!nochOffen && navigator.onLine) {
      setBeschaeftigt(true);
      const antwort = await crewRueckgaengig(holeDb(), a.code, eventRef.current);
      setBeschaeftigt(false);
      if (antwort) {
        setzeStand(antwort.drin);
        if (antwort.ergebnis === "zurueck" || antwort.ergebnis === "nicht_drin") {
          merkeDrin(summe, false);
          setAnzeige({ art: "urteil", code: a.code, wert: vorher, offline: false });
        } else {
          if (antwort.ergebnis === "keine_berechtigung") setAnmeldungWeg(true);
          setAnzeige({ art: "urteil", code: a.code, wert: antwort, offline: false });
        }
        return;
      }
      setSchwach(true);
    }
    merkeDrin(summe, false);
    merkeAktion(a.code, "zurueck");
    setAnzeige({ art: "urteil", code: a.code, wert: vorher, offline: true });
  }

  function abweisen() {
    const a = anzeigeRef.current;
    if (a.art !== "urteil") return;
    setAnzeige({ art: "entschieden", code: a.code, wert: a.wert, wie: "weg", offline: a.offline });
  }

  // --- Ein Code ---
  const verarbeite = useCallback(async (roh: string, getipptesFeld = false) => {
    const code = roh.trim().toUpperCase();
    if (!code) return;
    const jetzt = Date.now();
    if (!getipptesFeld) {
      if (zuletzt.current?.code === code && jetzt - zuletzt.current.zeit < SPERRE_MS) return;
      const a = anzeigeRef.current;
      if (a.art !== "bereit" && a.art !== "verbindung" && a.code === code && jetzt - angezeigtSeit.current < ANGEZEIGT_SPERRE_MS) {
        return;
      }
    }
    zuletzt.current = { code, zeit: jetzt };

    if (code.startsWith("G-")) {
      setAnzeige({
        art: "urteil",
        code,
        wert: { ergebnis: "unbekannt", event: "Das ist eine Garderobenmarke, kein Ticket." },
        offline: false,
      });
      anhalten();
      return;
    }

    const ev = eventRef.current;
    const summe = await pruefsumme(code);

    if (pruefenRef.current) {
      const antwort = navigator.onLine ? await crewPruefen(holeDb(), code, ev) : null;
      setAnzeige(antwort ? { art: "urteil", code, wert: { ...antwort, probe: true }, offline: false } : { art: "verbindung" });
      return;
    }

    let wert: CrewErgebnis | null = null;
    let offline = false;
    if (navigator.onLine) {
      wert = await crewPruefen(holeDb(), code, ev);
      if (wert) {
        setSchwach(false);
        setzeStand(wert.drin);
        if (wert.ergebnis === "keine_berechtigung") setAnmeldungWeg(true);
        if (wert.ergebnis === "schon_entwertet") merkeDrin(summe, true);
      } else {
        setSchwach(true);
      }
    }
    if (!wert) {
      offline = true;
      const gast = namenRef.current[summe] ?? null;
      wert = drinRef.current.has(summe)
        ? { ergebnis: "schon_entwertet", gast }
        : gueltigRef.current.has(summe)
          ? { ergebnis: "gueltig", gast }
          : { ergebnis: "unbekannt" };
    }

    if (wert.ergebnis === "gueltig" && modusRef.current === "automatisch") {
      setAnzeige({ art: "urteil", code, wert, offline });
      await reinlassen(code, wert, offline);
      return;
    }
    setAnzeige({ art: "urteil", code, wert, offline });
    if (wert.ergebnis !== "gueltig") anhalten();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Kamera ---
  async function starten() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      strom.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setKameraFehler(false);
      setLaeuft(true);
      laufend.current = true;
      const schritt = () => {
        const v = video.current;
        const c = leinwand.current;
        if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
          const kante = Math.min(v.videoWidth, v.videoHeight) * 0.7;
          c.width = kante;
          c.height = kante;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(v, (v.videoWidth - kante) / 2, (v.videoHeight - kante) / 2, kante, kante, 0, 0, kante, kante);
            const bild = ctx.getImageData(0, 0, kante, kante);
            const treffer = jsQR(bild.data, bild.width, bild.height, { inversionAttempts: "dontInvert" });
            if (treffer?.data && aktivRef.current) void verarbeite(treffer.data);
          }
        }
        if (laufend.current) requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    } catch {
      setKameraFehler(true);
    }
  }

  useEffect(() => {
    return () => {
      laufend.current = false;
      strom.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // --- Darstellung ---
  const offenHier = offen.filter((o) => o.eventId === eventId);
  const drinAnzeige =
    drinServer === null
      ? null
      : Math.max(0, drinServer + offenHier.reduce((n, o) => n + (o.aktion === "rein" ? 1 : -1), 0));
  const gewaehlt = events.find((e) => e.id === eventId);
  const netz = !online ? "aus" : schwach ? "schwach" : "gut";

  const u = urteilFuer(anzeige, drinAnzeige, gewaehlt?.titel);

  return (
    <div className="crew-schirm" hidden={!aktiv}>
      <header className="crew-kopf">
        <img src="/crew/app-icon-192.png" alt="" width={32} height={32} className="crew-kopf-icon" />
        <label className="crew-kopf-event">
          <span className="crew-kopf-titel">{gewaehlt?.titel ?? "Event wählen"}</span>
          <span className="crew-kopf-unter">
            {gewaehlt ? `${gewaehlt.entwurf ? "Entwurf · " : ""}${gewaehlt.wann}` : ""} · wechseln
          </span>
          <select
            className="crew-kopf-wahl"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            aria-label="Event"
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.entwurf ? "Entwurf · " : ""}
                {e.titel} · {e.wann}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary crew-pruefen"
          aria-pressed={nurPruefen}
          data-an={nurPruefen || undefined}
          onClick={() => {
            pruefenRef.current = !pruefenRef.current;
            setNurPruefen(pruefenRef.current);
            setAnzeige({ art: "bereit" });
          }}
        >
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          Nur prüfen
        </button>
      </header>

      {anmeldungWeg ? (
        <div role="status" className="crew-band" data-art="abgelaufen">
          <i className="ph-bold ph-warning-octagon" aria-hidden="true" />
          <span>
            Anmeldung abgelaufen{offen.length > 0 ? ` · ${offen.length} warten aufs Nachtragen` : ""}
          </span>
          <button type="button" className="crew-band-aktion" onClick={abmelden}>
            Neu anmelden
          </button>
        </div>
      ) : null}
      {doppelt.length > 0 ? (
        <div role="status" className="crew-band" data-art="doppelt">
          <i className="ph-bold ph-copy" aria-hidden="true" />
          <span>
            {doppelt.length === 1 ? "Ein Ticket kam zweimal rein" : `${doppelt.length} Tickets kamen zweimal rein`}:{" "}
            {doppelt.slice(-3).join(", ")}
          </span>
          <button type="button" className="crew-band-aktion" onClick={() => setDoppelt([])}>
            Gesehen
          </button>
        </div>
      ) : null}
      {nurPruefen ? (
        <div role="status" className="crew-band" data-art="pruefen">
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          <span>Nur prüfen aktiv. Nichts wird entwertet.</span>
          <button
            type="button"
            className="crew-band-aktion"
            onClick={() => {
              pruefenRef.current = false;
              setNurPruefen(false);
              setAnzeige({ art: "bereit" });
            }}
          >
            Aus
          </button>
        </div>
      ) : null}
      {!online ? (
        <div role="status" className="crew-band" data-art="offline">
          <i className="ph-bold ph-wifi-slash" aria-hidden="true" />
          <span>
            Ohne Netz. Einlässe werden gespeichert.
            {liste ? ` Liste von ${new Date(liste.stand).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}.` : " Keine Liste geladen!"}
          </span>
        </div>
      ) : null}

      <div className="crew-kamera" role="img" aria-label="Kamerabild">
        <video ref={video} className="crew-video" playsInline muted />
        <canvas ref={leinwand} hidden />
        {laeuft ? (
          <div className="crew-zielrahmen" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : (
          <button type="button" className="btn btn-primary crew-kamera-start" onClick={starten}>
            <i className="ph-bold ph-qr-code" aria-hidden="true" />
            {kameraFehler ? "Kamera erneut versuchen" : "Kamera starten"}
          </button>
        )}
      </div>

      <div
        ref={flaeche}
        className="crew-urteil"
        aria-live="assertive"
        style={{ "--u": `var(--${u.farbe})`, "--auf": `var(--auf-${u.farbe})` } as React.CSSProperties}
      >
        <span ref={funken} className="crew-funken" aria-hidden="true" />
        <span ref={zeile} className="crew-urteil-zeile">
          <i className={`ph-fill ${u.icon}`} aria-hidden="true" />
          <span className="crew-urteil-wort">{u.wort}</span>
        </span>
        <span className="crew-urteil-detail">{u.detail}</span>
        {u.name !== undefined ? (
          <span className="crew-urteil-name">
            <span className="crew-urteil-kicker">Name auf dem Ticket</span>
            <span className="crew-urteil-gast">{u.name ?? "Kein Name hinterlegt"}</span>
          </span>
        ) : null}
        {u.typ || u.fastlane ? (
          <span className="crew-urteil-art">
            {u.typ ? <span>{u.typ}</span> : null}
            {u.fastlane ? (
              <span className="crew-urteil-marke">
                <i className="ph-bold ph-lightning" aria-hidden="true" />
                Fast Lane
              </span>
            ) : null}
            {u.vip ? (
              <span className="crew-urteil-marke">
                <i className="ph-bold ph-crown-simple" aria-hidden="true" />
                VIP
              </span>
            ) : null}
          </span>
        ) : null}
        {anzeige.art === "urteil" && anzeige.wert.ergebnis === "gueltig" && !anzeige.wert.probe ? (
          <div className="crew-entscheidung">
            <button type="button" className="btn crew-abweisen" onClick={abweisen} disabled={beschaeftigt}>
              <i className="ph-bold ph-hand-palm" aria-hidden="true" />
              Abweisen
            </button>
            <button
              type="button"
              className="btn crew-reinlassen"
              disabled={beschaeftigt}
              onClick={() => void reinlassen(anzeige.code, anzeige.wert, anzeige.offline)}
            >
              <i className="ph-bold ph-sign-in" aria-hidden="true" />
              Reinlassen
            </button>
          </div>
        ) : anzeige.art === "entschieden" ? (
          <button type="button" className="btn crew-urteil-knopf" onClick={() => void rueckgaengig()} disabled={beschaeftigt}>
            <i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" />
            Rückgängig
          </button>
        ) : anzeige.art === "urteil" && anzeige.wert.ergebnis === "keine_berechtigung" ? (
          <button type="button" className="btn crew-urteil-knopf" onClick={abmelden}>
            <i className="ph-bold ph-sign-in" aria-hidden="true" />
            Jetzt neu anmelden
          </button>
        ) : null}
      </div>

      {handeingabe ? (
        <form
          className="crew-eingabe"
          onSubmit={(e) => {
            e.preventDefault();
            if (getippt.trim()) {
              void verarbeite(getippt, true);
              setGetippt("");
            }
          }}
        >
          <input
            className="input"
            value={getippt}
            onChange={(e) => setGetippt(e.target.value)}
            placeholder="Code eintippen"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
          <button type="submit" className="btn btn-primary">
            Prüfen
          </button>
        </form>
      ) : null}

      <footer className="crew-fuss">
        <span className="crew-netz" data-netz={netz}>
          <i
            className={`ph-fill ${netz === "gut" ? "ph-circle" : netz === "schwach" ? "ph-circle-half" : "ph-circle-dashed"}`}
            aria-hidden="true"
          />
          {netz === "gut" ? "Verbunden" : netz === "schwach" ? "Schwach" : "Ohne Netz"}
        </span>
        <span className="crew-belegung">
          <span>
            <strong>{drinAnzeige ?? "–"}</strong>
            {kapazitaet ? ` / ${kapazitaet}` : ""} drin
          </span>
          {offen.length > 0 ? (
            <span className="crew-offen">
              <i className="ph-bold ph-cloud-arrow-up" aria-hidden="true" />
              {offen.length} offen
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn btn-secondary crew-tastatur"
          aria-label={handeingabe ? "Eingabe schließen" : "Code von Hand eintippen"}
          aria-pressed={handeingabe}
          onClick={() => setHandeingabe((h) => !h)}
        >
          <i className="ph-bold ph-keyboard" aria-hidden="true" />
        </button>
      </footer>
      <p className="crew-liste-stand">
        {liste
          ? `Liste geladen · ${liste.anzahl} Tickets · Stand ${new Date(liste.stand).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
          : "Liste noch nicht geladen. Ohne Netz kennt das Gerät dann kein Ticket."}
      </p>
    </div>
  );
}

type Urteil = {
  farbe: string;
  icon: string;
  wort: string;
  detail: string;
  /** undefined: kein Namensblock; null: Ticket ohne Namen. */
  name?: string | null;
  typ?: string;
  fastlane?: boolean;
  vip?: boolean;
};

function urteilFuer(a: Anzeige, drin: number | null, eventTitel?: string): Urteil {
  if (a.art === "bereit") {
    return { farbe: "urteil-bereit", icon: "ph-scan", wort: "Bereit", detail: "Code in den Rahmen halten. Es geht von selbst." };
  }
  if (a.art === "verbindung") {
    return {
      farbe: "urteil-neu-anmelden",
      icon: "ph-wifi-slash",
      wort: "Kein Netz",
      detail: "Nur prüfen braucht Netz. Nichts wurde entwertet.",
    };
  }
  const w = a.wert;
  const person = {
    name: w.gast ?? (w.name_fehlt ? null : undefined),
    typ: [w.typ, w.platz].filter(Boolean).join(" · ") || undefined,
    fastlane: w.fastlane,
    vip: w.art === "vip",
  };
  const ohneNetz = a.offline ? " Ohne Netz entschieden, wird nachgetragen." : "";

  if (a.art === "entschieden") {
    return a.wie === "rein"
      ? {
          farbe: "urteil-einlass",
          icon: "ph-check-circle",
          wort: "Drin",
          detail: `Entwertet und gezählt.${drin !== null ? ` Jetzt ${drin} drin.` : ""}${ohneNetz}`,
          ...person,
        }
      : {
          farbe: "urteil-neu-anmelden",
          icon: "ph-hand-palm",
          wort: "Abgewiesen",
          detail: "Nicht gezählt. Das Ticket bleibt gültig.",
          ...person,
        };
  }

  switch (w.ergebnis) {
    case "gueltig":
      if (w.probe) {
        return { farbe: "urteil-pruefen", icon: "ph-magnifying-glass", wort: "Nur prüfen", detail: "Gültig. Nichts wurde entwertet.", ...person };
      }
      return {
        farbe: "urteil-einlass",
        icon: "ph-identification-card",
        wort: "Gültig",
        detail: `Ausweis prüfen: Name und ab 18. Dann entscheiden.${a.offline ? " (aus der Liste, ohne Netz)" : ""}`,
        ...person,
      };
    case "drin":
      return { farbe: "urteil-einlass", icon: "ph-check-circle", wort: "Drin", detail: "Entwertet und gezählt.", ...person };
    case "schon_entwertet":
      return {
        farbe: "urteil-schon-drin",
        icon: "ph-clock-counter-clockwise",
        wort: "Schon drin",
        detail: w.zeitpunkt
          ? `Um ${zeitText(w.zeitpunkt)} Uhr entwertet${w.eigenes ? " (von dir)" : ""}.`
          : a.offline
            ? "Laut Liste schon eingelassen."
            : "Schon eingelassen.",
        ...person,
      };
    case "storniert":
      return { farbe: "urteil-abgelehnt", icon: "ph-x-circle", wort: "Storniert", detail: "Ticket wurde erstattet. Kein Einlass.", ...person };
    case "anderes_event":
      return {
        farbe: "urteil-abgelehnt",
        icon: "ph-calendar-x",
        wort: "Anderes Event",
        detail: `Gilt für ${w.event ?? "ein anderes Event"}${w.beginn ? `, ${datumText(w.beginn)}` : ""}. Nicht für ${eventTitel ?? "dieses Event"}.`,
        typ: w.typ,
      };
    case "keine_berechtigung":
      return {
        farbe: "urteil-neu-anmelden",
        icon: "ph-sign-in",
        wort: "Neu anmelden",
        detail: "Liegt nicht am Ticket. Deine Anmeldung ist abgelaufen.",
      };
    case "nicht_erlaubt":
      return {
        farbe: "urteil-schon-drin",
        icon: "ph-lock",
        wort: "Gesperrt",
        detail: "Zurücknehmen geht nur beim eigenen Einlass der letzten 30 Minuten. Frag die Leitung.",
        ...person,
      };
    default:
      return {
        farbe: "urteil-abgelehnt",
        icon: "ph-question",
        wort: "Unbekannt",
        detail: w.event ?? (a.offline ? "Ohne Netz: nicht in der Liste dieses Events." : "Kein Ticket von uns. Nicht weiter prüfen."),
      };
  }
}
