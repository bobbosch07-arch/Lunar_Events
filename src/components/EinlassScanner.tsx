"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Knopf } from "./Knopf";
import { GaesteNamensliste } from "./GaesteNamensliste";
import { browserClient } from "@/lib/supabase/client";
import {
  holeListe,
  pruefsumme,
  scanne,
  trageNach,
  type EinlassErgebnis,
} from "@/lib/einlass";
import css from "./EinlassScanner.module.css";

type Event = { id: string; titel: string; wann: string; entwurf?: boolean };

type Zustand =
  | { art: "leer" }
  | { art: "ergebnis"; wert: EinlassErgebnis }
  /** Nur beim Prüfen ohne Einlass: Das geht nur mit Netz. */
  | { art: "verbindung" };

/** Derselbe Code wird am Einlass gern zweimal hintereinander gescannt. */
const SPERRE_MS = 2500;
/**
 * So oft wird die Liste für den Betrieb ohne Netz neu geholt, solange Netz
 * da ist: Namen lassen sich bis Beginn ändern, wer kurz vorher kauft, fehlte
 * sonst, und was andere Geräte einlassen, steht dann als "drin" darin.
 */
const AUFFRISCHEN_MS = 5 * 60 * 1000;
/** So oft wird versucht, ohne Netz gesammelte Scans nachzutragen. */
const NACHTRAGEN_MS = 20 * 1000;

// Gesammelte Scans gelten für alle Events (jeder trägt sein Event), Liste und
// "drin" je Event: Wer nachts das Event wechselt, nimmt sonst die falsche Liste.
const SPEICHER_PUFFER = "lunar.einlass.puffer";
const speicherListe = (eventId: string) => `lunar.einlass.liste.${eventId}`;
const speicherDrin = (eventId: string) => `lunar.einlass.drin.${eventId}`;

/** Ein ohne Netz eingelassener Scan. Ohne eventId: aus der Zeit vor 0048. */
type Gepuffert = { code: string; zeit: number; eventId?: string };

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

/**
 * Der Scanner am Einlass.
 *
 * Alles, was die Kamera-Schleife braucht, steht in Refs, nicht im Zustand:
 * Die Schleife läuft vom Start der Kamera an mit derselben Funktion weiter.
 * Bis 0048 las sie den Zustand vom Moment des Starts; ohne Netz überschrieb
 * jeder Scan den vorigen im Puffer, und eine danach geladene Liste kam nie
 * an (jedes Ticket "Unbekannt").
 */
export function EinlassScanner({
  events,
  darfPruefen = false,
}: {
  events: Event[];
  /** Admins: Schalter "Nur prüfen" (nichts wird entwertet). */
  darfPruefen?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const strom = useRef<MediaStream | null>(null);
  const zuletzt = useRef<{ code: string; zeit: number } | null>(null);
  const laufend = useRef(false);
  // Auf der Namensliste läuft die Kamera weiter (kein neues Freigeben beim
  // Zurückwechseln), sucht aber keine Codes.
  const modusRef = useRef<"scan" | "liste">("scan");
  const [modus, setModus] = useState<"scan" | "liste">("scan");
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const holeDb = () => (db.current ??= browserClient());

  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const eventRef = useRef(eventId);
  const [nurPruefen, setNurPruefen] = useState(false);
  const pruefenRef = useRef(false);

  const [laeuft, setLaeuft] = useState(false);
  const [zustand, setZustand] = useState<Zustand>({ art: "leer" });
  const [online, setOnline] = useState(true);
  // Die letzte Anfrage kam nicht rechtzeitig zurück, obwohl das Gerät Netz meldet.
  const [schwach, setSchwach] = useState(false);
  const [gezaehlt, setGezaehlt] = useState(0);
  const [handeingabe, setHandeingabe] = useState(false);
  const [getippt, setGetippt] = useState("");
  // Beim Nachtragen gefunden: Tickets, die ein anderes Konto vorher eingelassen hatte.
  const [doppelt, setDoppelt] = useState<string[]>([]);
  const [anmeldungWeg, setAnmeldungWeg] = useState(false);

  const pufferRef = useRef<Gepuffert[]>([]);
  const [pufferAnzahl, setPufferAnzahl] = useState(0);
  const gueltigRef = useRef<Set<string>>(new Set());
  const drinRef = useRef<Set<string>>(new Set());
  const namenRef = useRef<Record<string, string>>({});
  const [listeAnzahl, setListeAnzahl] = useState(0);
  const nachtragenLaeuft = useRef(false);

  function setzePuffer(neu: Gepuffert[]) {
    pufferRef.current = neu;
    setPufferAnzahl(neu.length);
    schreib(SPEICHER_PUFFER, neu);
  }

  function merkeDrin(summe: string) {
    drinRef.current.add(summe);
    schreib(speicherDrin(eventRef.current), [...drinRef.current]);
  }

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

  // --- Gesammelte Scans vom letzten Mal ---
  useEffect(() => {
    const alt = lies<Gepuffert[]>(SPEICHER_PUFFER, []);
    pufferRef.current = alt;
    setPufferAnzahl(alt.length);
    // Listen aus der Zeit vor 0048 (ein Satz für alle Events) wegräumen.
    try {
      localStorage.removeItem("lunar.einlass.summen");
      localStorage.removeItem("lunar.einlass.namen");
    } catch {
      // egal
    }
  }, []);

  // --- Liste für den Betrieb ohne Netz, je Event ---
  useEffect(() => {
    eventRef.current = eventId;
    if (!eventId) return;
    const gespeichert = lies<{ gueltig: string[]; drin: string[]; namen: Record<string, string> } | null>(
      speicherListe(eventId),
      null,
    );
    gueltigRef.current = new Set(gespeichert?.gueltig ?? []);
    drinRef.current = new Set([...(gespeichert?.drin ?? []), ...lies<string[]>(speicherDrin(eventId), [])]);
    namenRef.current = gespeichert?.namen ?? {};
    setListeAnzahl(gueltigRef.current.size);
    setGezaehlt(0);
    setZustand({ art: "leer" });
  }, [eventId]);

  useEffect(() => {
    if (!eventId || !online) return;
    let aktiv = true;
    const holen = async () => {
      const liste = await holeListe(holeDb(), eventId);
      if (!liste || !aktiv || eventRef.current !== eventId) return;
      setSchwach(false);
      gueltigRef.current = new Set(liste.gueltig);
      // Was dieses Gerät eingelassen hat und noch nachträgt, bleibt "drin".
      drinRef.current = new Set([...liste.drin, ...lies<string[]>(speicherDrin(eventId), [])]);
      namenRef.current = liste.namen;
      setListeAnzahl(liste.gueltig.length);
      schreib(speicherListe(eventId), liste);
    };
    void holen();
    const takt = setInterval(() => void holen(), AUFFRISCHEN_MS);
    return () => {
      aktiv = false;
      clearInterval(takt);
    };
  }, [eventId, online]);

  // --- Ohne Netz gesammelte Scans nachtragen ---
  const nachtragen = useCallback(async () => {
    if (nachtragenLaeuft.current || !navigator.onLine || pufferRef.current.length === 0) return;
    nachtragenLaeuft.current = true;
    try {
      const offen = pufferRef.current.slice(0, 400);
      const erledigt = new Set<Gepuffert>();
      // Je Event ein Aufruf: Die Datenbank prüft gegen das Event des Scans.
      const gruppen = new Map<string, Gepuffert[]>();
      for (const g of offen) {
        const k = g.eventId ?? "";
        gruppen.set(k, [...(gruppen.get(k) ?? []), g]);
      }
      for (const [ev, teil] of gruppen) {
        const antwort = await trageNach(holeDb(), teil.map((g) => g.code), ev || null);
        if (!antwort) break;
        // Die Datenbank hat geantwortet: Das Netz trägt wieder.
        setSchwach(false);
        if (antwort.some((a) => a.ergebnis === "keine_berechtigung")) {
          // Abgemeldet: Die Scans bleiben, bis wieder jemand angemeldet ist.
          setAnmeldungWeg(true);
          break;
        }
        teil.forEach((g) => erledigt.add(g));
        const zweimal = antwort
          .filter((a) => a.ergebnis === "schon_entwertet" && !a.eigenes)
          .map((a) => a.gast ?? a.code);
        if (zweimal.length > 0) setDoppelt((d) => [...d, ...zweimal]);
      }
      if (erledigt.size > 0) {
        // Was während des Nachtragens dazukam, bleibt im Puffer.
        setzePuffer(pufferRef.current.filter((g) => !erledigt.has(g)));
      }
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

  // --- Einen Code verarbeiten ---
  const verarbeite = useCallback(async (roh: string) => {
    const code = roh.trim().toUpperCase();
    if (!code) return;
    const jetzt = Date.now();
    if (zuletzt.current && zuletzt.current.code === code && jetzt - zuletzt.current.zeit < SPERRE_MS) {
      return;
    }
    zuletzt.current = { code, zeit: jetzt };
    if (navigator.vibrate) navigator.vibrate(40);

    // Garderobenmarken (0027) beginnen mit "G-" — das Ticketalphabet hat
    // keinen Bindestrich. Statt "Unbekannt" sagen, was es ist.
    if (code.startsWith("G-")) {
      setZustand({
        art: "ergebnis",
        wert: { ergebnis: "unbekannt", event: "Das ist eine Garderobenmarke, kein Ticket." },
      });
      return;
    }

    const eventJetzt = eventRef.current;
    const summe = await pruefsumme(code);

    // Nur prüfen: immer die Datenbank, nie etwas entwerten.
    if (pruefenRef.current) {
      const antwort = navigator.onLine ? await scanne(holeDb(), code, eventJetzt, true) : null;
      setZustand(antwort ? { art: "ergebnis", wert: antwort } : { art: "verbindung" });
      return;
    }

    if (navigator.onLine) {
      const antwort = await scanne(holeDb(), code, eventJetzt, false);
      if (antwort) {
        setSchwach(false);
        if (antwort.ergebnis === "keine_berechtigung") setAnmeldungWeg(true);
        if (antwort.ergebnis === "gueltig") {
          merkeDrin(summe);
          setGezaehlt((z) => z + 1);
        }
        if (antwort.ergebnis === "schon_entwertet") merkeDrin(summe);
        setZustand({ art: "ergebnis", wert: antwort });
        return;
      }
      // Keine Antwort in der Zeit: wie ohne Netz weiter, der Gast wartet.
      setSchwach(true);
    }

    // Ohne Netz entscheidet die Liste. "Drin" kennt das Gerät aus der Liste
    // (andere Geräte bis zum letzten Abruf) und von sich selbst.
    const gast = namenRef.current[summe] ?? null;
    if (drinRef.current.has(summe)) {
      setZustand({ art: "ergebnis", wert: { ergebnis: "schon_entwertet", gast, gepuffert: true } });
      return;
    }
    if (gueltigRef.current.has(summe)) {
      merkeDrin(summe);
      setzePuffer([...pufferRef.current, { code, zeit: jetzt, eventId: eventJetzt }]);
      setGezaehlt((z) => z + 1);
      setZustand({ art: "ergebnis", wert: { ergebnis: "gueltig", gast, gepuffert: true } });
      return;
    }
    setZustand({ art: "ergebnis", wert: { ergebnis: "unbekannt", gepuffert: true } });
  }, []);

  // --- Kamera ---
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

      const schritt = () => {
        const v = video.current;
        const c = leinwand.current;
        if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
          // Nur die Bildmitte durchsuchen: schneller, und der Zielrahmen sagt
          // dem Personal ohnehin, wo das Ticket hingehalten wird.
          const kante = Math.min(v.videoWidth, v.videoHeight) * 0.7;
          c.width = kante;
          c.height = kante;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(
              v,
              (v.videoWidth - kante) / 2,
              (v.videoHeight - kante) / 2,
              kante,
              kante,
              0,
              0,
              kante,
              kante,
            );
            const bild = ctx.getImageData(0, 0, kante, kante);
            const treffer = jsQR(bild.data, bild.width, bild.height, {
              inversionAttempts: "dontInvert",
            });
            if (treffer?.data && modusRef.current === "scan") void verarbeite(treffer.data);
          }
        }
        if (laufend.current) requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    } catch {
      setZustand({
        art: "ergebnis",
        wert: { ergebnis: "unbekannt", event: "Kamera nicht freigegeben" },
      });
    }
  }

  useEffect(() => {
    return () => {
      laufend.current = false;
      strom.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const datum = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  const urteil = (() => {
    if (zustand.art === "leer") return null;
    if (zustand.art === "verbindung") {
      return { klasse: "verbindung", text: "Keine Verbindung" };
    }
    const w = zustand.wert;
    switch (w.ergebnis) {
      case "gueltig":
        if (w.probe) return { klasse: "probe", text: "Gültig" };
        return { klasse: "gueltig", text: w.gepuffert ? "Einlass (offline)" : "Einlass" };
      case "schon_entwertet":
        return { klasse: "schon_entwertet", text: "Schon drin" };
      case "storniert":
        return { klasse: "storniert", text: "Storniert" };
      case "anderes_event":
        return { klasse: "storniert", text: "Anderes Event" };
      case "keine_berechtigung":
        return { klasse: "keine_berechtigung", text: "Neu anmelden" };
      default:
        return { klasse: "unbekannt", text: "Unbekannt" };
    }
  })();

  const gewaehlt = events.find((e) => e.id === eventId);

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <select
          className={css.eventwahl}
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
        <div className={css.zaehler}>
          <span className={css.zaehlerWert}>{gezaehlt}</span>
          <span className={css.zaehlerName}>eingelassen</span>
        </div>
      </header>

      <div className={css.modus} role="tablist" aria-label="Einlass">
        {(
          [
            ["scan", "Scannen"],
            ["liste", "Gästeliste"],
          ] as const
        ).map(([wert, name]) => (
          <button
            key={wert}
            type="button"
            role="tab"
            aria-selected={modus === wert}
            className={`${css.modusKnopf} ${modus === wert ? css.modusAktiv : ""}`}
            onClick={() => {
              modusRef.current = wert;
              setModus(wert);
            }}
          >
            {name}
          </button>
        ))}
        {darfPruefen ? (
          <button
            type="button"
            aria-pressed={nurPruefen}
            className={`${css.modusKnopf} ${nurPruefen ? css.pruefenAktiv : ""}`}
            onClick={() => {
              pruefenRef.current = !pruefenRef.current;
              setNurPruefen(pruefenRef.current);
              setZustand({ art: "leer" });
            }}
          >
            Nur prüfen
          </button>
        ) : null}
      </div>

      {/* Unübersehbar: Wer den Schalter vergisst, lässt niemanden ein. */}
      {nurPruefen ? (
        <p className={css.pruefenBand}>
          Nur prüfen · Es wird niemand eingelassen und kein Ticket entwertet.
        </p>
      ) : null}

      {anmeldungWeg ? (
        <div className={css.warnBand}>
          <span>
            Anmeldung abgelaufen oder nicht mehr freigeschaltet. Das liegt nicht an den Tickets.
            {pufferAnzahl > 0 ? ` ${pufferAnzahl} Scans warten aufs Nachtragen.` : ""}
          </span>
          <Knopf href="/auth/abmelden?weiter=/einlass" stil="hell" groesse="klein">
            Neu anmelden
          </Knopf>
        </div>
      ) : null}

      {doppelt.length > 0 ? (
        <div className={css.warnBand}>
          <span>
            {doppelt.length === 1
              ? "Ein Ticket kam zweimal rein"
              : `${doppelt.length} Tickets kamen zweimal rein`}{" "}
            (ohne Netz gescannt, ein anderes Gerät war schneller): {doppelt.slice(-5).join(", ")}
          </span>
          <button type="button" className={css.handeingabe} onClick={() => setDoppelt([])}>
            Gesehen
          </button>
        </div>
      ) : null}

      {modus === "liste" ? (
        <GaesteNamensliste
          eventId={eventId}
          online={online}
          eingelassen={(n) => setGezaehlt((z) => z + n)}
        />
      ) : null}

      <div className={css.buehne} hidden={modus !== "scan"}>
        <video ref={video} className={css.video} playsInline muted />
        <canvas ref={leinwand} hidden />
        {laeuft ? (
          <div className={css.zielrahmen} aria-hidden="true">
            <span />
          </div>
        ) : (
          <button type="button" className={css.startknopf} onClick={starten}>
            <strong>Kamera starten</strong>
            <span className={css.startHinweis}>
              Beim ersten Mal fragt das Telefon nach der Erlaubnis. Ohne
              Kamera kannst du Codes auch eintippen.
            </span>
          </button>
        )}
      </div>

      <div
        className={`${css.ergebnis} ${urteil ? css[urteil.klasse] : css.leer}`}
        aria-live="assertive"
        hidden={modus !== "scan"}
      >
        {urteil ? (
          <>
            <span className={css.urteil}>{urteil.text}</span>
            {zustand.art === "ergebnis" ? (
              <>
                {/* Groß und eigenständig: Wer am Eingang steht, muss es aus
                    einem Meter Abstand sehen, bevor er jemanden an der
                    Schlange vorbeiwinkt. Der Name für den Ausweis (0046)
                    kommt ohne Netz aus der vorab geladenen Liste. */}
                {zustand.wert.ergebnis === "anderes_event" ? (
                  <span className={css.detail}>
                    Ticket für {zustand.wert.event}
                    {zustand.wert.beginn ? `, ${datum(zustand.wert.beginn)}` : ""}. Gilt nicht für{" "}
                    {gewaehlt?.titel ?? "dieses Event"}.
                  </span>
                ) : zustand.wert.ergebnis === "keine_berechtigung" ? (
                  <span className={css.detail}>
                    Das liegt nicht am Ticket. Oben auf „Neu anmelden“ tippen.
                  </span>
                ) : (
                  <>
                    {zustand.wert.gast ? (
                      <span className={css.gastname}>{zustand.wert.gast}</span>
                    ) : zustand.wert.name_fehlt ? (
                      <span className={css.nameFehlt}>Kein Name hinterlegt</span>
                    ) : null}
                    {zustand.wert.fastlane ? (
                      <span className={css.fastlane}>Fast Lane</span>
                    ) : null}
                    {zustand.wert.typ ? (
                      <span className={css.detail}>
                        {zustand.wert.typ}
                        {zustand.wert.platz ? ` · ${zustand.wert.platz}` : ""}
                      </span>
                    ) : null}
                  </>
                )}
                {zustand.wert.event && zustand.wert.ergebnis !== "anderes_event" ? (
                  <span className={css.nebensache}>{zustand.wert.event}</span>
                ) : null}
                {zustand.wert.zeitpunkt ? (
                  <span className={css.nebensache}>
                    Eingelöst um{" "}
                    {new Date(zustand.wert.zeitpunkt).toLocaleTimeString("de-DE", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                ) : null}
                {zustand.wert.probe ? (
                  <span className={css.nebensache}>Nur geprüft, nicht eingelöst.</span>
                ) : null}
                {zustand.wert.gepuffert ? (
                  <span className={css.nebensache}>
                    {zustand.wert.ergebnis === "gueltig"
                      ? "Ohne Netz entschieden. Wird nachgetragen, sobald Empfang da ist."
                      : zustand.wert.ergebnis === "unbekannt"
                        ? "Ohne Netz: nicht in der Liste dieses Events."
                        : "Ohne Netz: dieses Ticket ist schon eingelassen."}
                  </span>
                ) : null}
              </>
            ) : (
              <span className={css.nebensache}>
                Nur prüfen braucht Netz. Nichts wurde eingelöst.
              </span>
            )}
          </>
        ) : (
          <p className={css.wartet}>
            Ticket in den Rahmen halten. Das Ergebnis erscheint hier groß —
            grün heißt rein, alles andere heißt anhalten.
          </p>
        )}
      </div>

      {handeingabe && modus === "scan" ? (
        <form
          className={css.eingabezeile}
          onSubmit={(e) => {
            e.preventDefault();
            if (getippt.trim()) {
              // Getippt heißt gewollt: auch derselbe Code gleich nochmal.
              zuletzt.current = null;
              void verarbeite(getippt);
              setGetippt("");
            }
          }}
        >
          <input
            className={css.codefeld}
            value={getippt}
            onChange={(e) => setGetippt(e.target.value)}
            placeholder="Code eintippen…"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <Knopf type="submit" stil="hell" groesse="klein">
            Prüfen
          </Knopf>
        </form>
      ) : null}

      <footer className={css.fussleiste}>
        <span className={css.netz}>
          <span
            className={`${css.punkt} ${!online ? css.offline : schwach ? css.schwach : css.online}`}
          />
          {!online
            ? `Ohne Netz · ${listeAnzahl} Tickets in der Liste`
            : schwach
              ? "Schwaches Netz · entscheidet aus der Liste"
              : "Verbunden"}
          {pufferAnzahl > 0 ? ` · ${pufferAnzahl} zum Nachtragen` : ""}
        </span>
        <button
          type="button"
          className={css.handeingabe}
          onClick={() => setHandeingabe((h) => !h)}
        >
          {handeingabe ? "Eingabe schließen" : "Code eintippen"}
        </button>
      </footer>
    </div>
  );
}
