"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Knopf } from "./Knopf";
import { entwerte, holePruefsummen, type EinlassErgebnis } from "@/app/aktionen/einlass";
import css from "./EinlassScanner.module.css";

type Event = { id: string; titel: string; wann: string };

type Zustand =
  | { art: "leer" }
  | { art: "ergebnis"; wert: EinlassErgebnis & { gepuffert?: boolean } }
  | { art: "verbindung" };

/** Derselbe Code wird am Einlass gern zweimal hintereinander gescannt. */
const SPERRE_MS = 2500;

const SPEICHER_PUFFER = "lunar.einlass.puffer";
const SPEICHER_SUMMEN = "lunar.einlass.summen";

type Gepuffert = { code: string; zeit: number };

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

export function EinlassScanner({ events }: { events: Event[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const strom = useRef<MediaStream | null>(null);
  const zuletzt = useRef<{ code: string; zeit: number } | null>(null);
  const laufend = useRef(false);

  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const [laeuft, setLaeuft] = useState(false);
  const [zustand, setZustand] = useState<Zustand>({ art: "leer" });
  const [online, setOnline] = useState(true);
  const [gezaehlt, setGezaehlt] = useState(0);
  const [puffer, setPuffer] = useState<Gepuffert[]>([]);
  const [summen, setSummen] = useState<Set<string>>(new Set());
  const [handeingabe, setHandeingabe] = useState(false);
  const [getippt, setGetippt] = useState("");

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

  useEffect(() => {
    setPuffer(lies<Gepuffert[]>(SPEICHER_PUFFER, []));
    setSummen(new Set(lies<string[]>(SPEICHER_SUMMEN, [])));
  }, []);

  // --- Prüfsummen für den Betrieb ohne Netz ---
  useEffect(() => {
    if (!eventId || !online) return;
    holePruefsummen(eventId).then(({ ok, summen: neu }) => {
      if (!ok) return;
      setSummen(new Set(neu));
      schreib(SPEICHER_SUMMEN, neu);
    });
  }, [eventId, online]);

  // --- Gepufferte Scans nachreichen ---
  const nachreichen = useCallback(async () => {
    if (!online || puffer.length === 0) return;
    const offen = [...puffer];
    const uebrig: Gepuffert[] = [];

    for (const eintrag of offen) {
      try {
        await entwerte(eintrag.code);
      } catch {
        uebrig.push(eintrag);
      }
    }

    setPuffer(uebrig);
    schreib(SPEICHER_PUFFER, uebrig);
  }, [online, puffer]);

  useEffect(() => {
    void nachreichen();
  }, [nachreichen]);

  // --- Einen Code verarbeiten ---
  const verarbeite = useCallback(
    async (code: string) => {
      const sauber = code.trim().toUpperCase();
      const jetzt = Date.now();

      if (
        zuletzt.current &&
        zuletzt.current.code === sauber &&
        jetzt - zuletzt.current.zeit < SPERRE_MS
      ) {
        return;
      }
      zuletzt.current = { code: sauber, zeit: jetzt };

      if (navigator.vibrate) navigator.vibrate(40);

      if (!navigator.onLine) {
        // Ohne Netz entscheidet die Prüfsummenliste, ob der Code zu
        // diesem Event gehört. Die Entwertung wird nachgereicht.
        const summe = await pruefsumme(sauber);
        const bekannt = summen.has(summe);
        const neu = [...puffer, { code: sauber, zeit: jetzt }];
        if (bekannt) {
          setPuffer(neu);
          schreib(SPEICHER_PUFFER, neu);
          setGezaehlt((z) => z + 1);
        }
        setZustand({
          art: "ergebnis",
          wert: bekannt
            ? { ergebnis: "gueltig", gepuffert: true }
            : { ergebnis: "unbekannt" },
        });
        return;
      }

      try {
        const wert = await entwerte(sauber);
        setZustand({ art: "ergebnis", wert });
        if (wert.ergebnis === "gueltig") setGezaehlt((z) => z + 1);
      } catch {
        setZustand({ art: "verbindung" });
      }
    },
    [puffer, summen],
  );

  // --- Kamera ---
  const suchen = useCallback(() => {
    const v = video.current;
    const c = leinwand.current;
    if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) {
      if (laufend.current) requestAnimationFrame(suchen);
      return;
    }

    // Nur die Bildmitte durchsuchen: schneller, und der Zielrahmen sagt
    // dem Personal ohnehin, wo das Ticket hingehalten wird.
    const kante = Math.min(v.videoWidth, v.videoHeight) * 0.7;
    c.width = kante;
    c.height = kante;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

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

    if (treffer?.data) void verarbeite(treffer.data);
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

  const urteil = (() => {
    if (zustand.art === "leer") return null;
    if (zustand.art === "verbindung") return { klasse: "verbindung", text: "Keine Verbindung" };
    switch (zustand.wert.ergebnis) {
      case "gueltig":
        return { klasse: "gueltig", text: zustand.wert.gepuffert ? "Einlass (offline)" : "Einlass" };
      case "schon_entwertet":
        return { klasse: "schon_entwertet", text: "Schon drin" };
      case "storniert":
        return { klasse: "storniert", text: "Storniert" };
      case "keine_berechtigung":
        return { klasse: "keine_berechtigung", text: "Nicht berechtigt" };
      default:
        return { klasse: "unbekannt", text: "Unbekannt" };
    }
  })();

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
              {e.titel} · {e.wann}
            </option>
          ))}
        </select>
        <div className={css.zaehler}>
          <span className={css.zaehlerWert}>{gezaehlt}</span>
          <span className={css.zaehlerName}>eingelassen</span>
        </div>
      </header>

      <div className={css.buehne}>
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
      >
        {urteil ? (
          <>
            <span className={css.urteil}>{urteil.text}</span>
            {zustand.art === "ergebnis" ? (
              <>
                {/* Groß und eigenständig: Wer am Eingang steht, muss es aus
                    einem Meter Abstand sehen, bevor er jemanden an der
                    Schlange vorbeiwinkt. Offline kennt der Scanner nur die
                    Prüfsumme — dann steht hier nichts. */}
                {zustand.wert.fastlane ? (
                  <span className={css.fastlane}>Fast Lane</span>
                ) : null}
                {zustand.wert.typ ? (
                  <span className={css.detail}>
                    {zustand.wert.typ}
                    {zustand.wert.platz ? ` · ${zustand.wert.platz}` : ""}
                  </span>
                ) : null}
                {zustand.wert.event ? (
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
                {zustand.wert.gepuffert ? (
                  <span className={css.nebensache}>
                    Ohne Netz gescannt — wird nachgetragen, sobald Empfang da ist.
                  </span>
                ) : null}
              </>
            ) : (
              <span className={css.nebensache}>
                Der Scan wurde nicht gespeichert. Nochmal versuchen.
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

      {handeingabe ? (
        <form
          className={css.eingabezeile}
          onSubmit={(e) => {
            e.preventDefault();
            if (getippt.trim()) {
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
          <span className={`${css.punkt} ${online ? css.online : css.offline}`} />
          {online
            ? puffer.length > 0
              ? `${puffer.length} werden nachgetragen`
              : "Verbunden"
            : `Ohne Netz · ${summen.size} Tickets bekannt`}
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
