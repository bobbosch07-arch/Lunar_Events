"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { crewGaeste, crewGastEin, crewGastZurueck, type CrewGast } from "@/lib/einlass";
import { ABLAGE, lies, schreib } from "@/lib/crew/ablage";

type Offen = { id: string; gastId: string; anzahl: number; eventId: string; zeit: number };
type Filter = "alle" | "offen" | "drin";
/** `rueck`: was „Rückgängig“ zurücknimmt; mit `offenId` nur aus der Warteschlange. */
type Meldung = {
  art: "gut" | "schon" | "nein";
  text: string;
  rueck?: { gast: CrewGast; anzahl: number; offenId?: string };
};

const NACHTRAGEN_MS = 20 * 1000;
const AUFFRISCHEN_MS = 2 * 60 * 1000;
const jetzt = () => Date.now();

/**
 * Gästeliste der Crew-App (Design: 05 · Gästeliste). Wer nicht per QR
 * reinkommt, wird hier eingelassen — entwertet werden dieselben Tickets wie
 * beim Scan, deshalb zählt es von selbst auf „drin“ (0049).
 *
 * Ohne Netz wie der Scanner: Die Liste liegt in der Ablage (nur Name, Notiz,
 * Personenzahl), Einlässe werden gesammelt und nachgetragen. Mehr Personen,
 * als ein Eintrag hat, lässt die Datenbank auch dann nicht rein, wenn zwei
 * Geräte gleichzeitig abhaken.
 */
export function CrewGaeste({ eventId, online }: { eventId: string; online: boolean }) {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const holeDb = () => (db.current ??= browserClient());

  const [gaeste, setGaeste] = useState<CrewGast[]>([]);
  const [stand, setStand] = useState<number | null>(null);
  const [suche, setSuche] = useState("");
  const [filter, setFilter] = useState<Filter>("alle");
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const offenRef = useRef<Offen[]>([]);
  const [offen, setOffenState] = useState<Offen[]>([]);
  const nachtragenLaeuft = useRef(false);

  function setOffen(neu: Offen[]) {
    offenRef.current = neu;
    setOffenState(neu);
    void schreib(ABLAGE.gaesteAktionen, neu);
  }

  function setzeGaeste(neu: CrewGast[], zeit?: number) {
    setGaeste(neu);
    if (zeit) setStand(zeit);
    void schreib(ABLAGE.gaeste(eventId), { gaeste: neu, stand: zeit ?? stand ?? jetzt() });
  }

  // Gespeicherten Stand sofort zeigen, auch ohne Netz.
  useEffect(() => {
    let aktiv = true;
    void Promise.all([
      lies<{ gaeste: CrewGast[]; stand: number } | null>(ABLAGE.gaeste(eventId), null),
      lies<Offen[]>(ABLAGE.gaesteAktionen, []),
    ]).then(([l, o]) => {
      if (!aktiv) return;
      if (l) {
        setGaeste(l.gaeste);
        setStand(l.stand);
      }
      if (offenRef.current.length === 0) {
        offenRef.current = o;
        setOffenState(o);
      }
    });
    return () => {
      aktiv = false;
    };
  }, [eventId]);

  const laden = useCallback(async () => {
    const neu = await crewGaeste(holeDb(), eventId);
    if (!neu) return;
    // Was noch nachgetragen wird, bleibt in der Anzeige drin.
    const mitOffen = neu.map((g) => {
      const n = offenRef.current.filter((o) => o.gastId === g.id).reduce((s, o) => s + o.anzahl, 0);
      return n ? { ...g, drin: Math.min(g.personen, g.drin + n) } : g;
    });
    setGaeste(mitOffen);
    const zeit = Date.now();
    setStand(zeit);
    void schreib(ABLAGE.gaeste(eventId), { gaeste: mitOffen, stand: zeit });
  }, [eventId]);

  useEffect(() => {
    if (!online) return;
    void laden();
    const takt = setInterval(() => void laden(), AUFFRISCHEN_MS);
    return () => clearInterval(takt);
  }, [online, laden]);

  const nachtragen = useCallback(async () => {
    if (nachtragenLaeuft.current || !navigator.onLine || offenRef.current.length === 0) return;
    nachtragenLaeuft.current = true;
    try {
      const erledigt = new Set<string>();
      for (const o of offenRef.current) {
        const antwort = await crewGastEin(holeDb(), o.gastId, o.anzahl);
        if (!antwort || antwort.ergebnis === "keine_berechtigung") break;
        erledigt.add(o.id);
      }
      if (erledigt.size > 0) {
        setOffen(offenRef.current.filter((o) => !erledigt.has(o.id)));
        void laden();
      }
    } finally {
      nachtragenLaeuft.current = false;
    }
  }, [laden]);

  useEffect(() => {
    if (!online) return;
    void nachtragen();
    const takt = setInterval(() => void nachtragen(), NACHTRAGEN_MS);
    return () => clearInterval(takt);
  }, [online, nachtragen]);

  function aktualisiere(id: string, drin: number, personen?: number) {
    setzeGaeste(gaeste.map((g) => (g.id === id ? { ...g, drin, personen: personen ?? g.personen } : g)));
  }

  async function einlassen(gast: CrewGast, anzahl: number) {
    if (laeuft) return;
    const rest = Math.max(gast.personen - gast.drin, 0);
    const n = Math.min(anzahl, rest);
    if (n === 0) return;
    try {
      navigator.vibrate?.(40);
    } catch {
      // iPhone kennt es nicht.
    }

    if (navigator.onLine) {
      setLaeuft(gast.id);
      const antwort = await crewGastEin(holeDb(), gast.id, n);
      setLaeuft(null);
      if (antwort) {
        if (antwort.ergebnis === "gueltig") {
          aktualisiere(gast.id, antwort.drin ?? gast.drin + n, antwort.personen);
          setMeldung({
            art: "gut",
            text: `${antwort.eingelassen === 1 ? "1 Person" : `${antwort.eingelassen} Personen`} rein · ${gast.name}`,
            rueck: { gast, anzahl: antwort.eingelassen ?? n },
          });
        } else if (antwort.ergebnis === "schon_drin") {
          aktualisiere(gast.id, antwort.drin ?? gast.personen, antwort.personen);
          setMeldung({ art: "schon", text: `Schon alle drin · ${gast.name}` });
        } else {
          setMeldung({
            art: "nein",
            text:
              antwort.ergebnis === "keine_berechtigung"
                ? "Anmeldung abgelaufen. Im Scanner neu anmelden."
                : `Nicht mehr auf der Liste · ${gast.name}`,
          });
          void laden();
        }
        return;
      }
    }

    // Ohne Antwort: merken und nachtragen.
    const offenId = crypto.randomUUID();
    setOffen([...offenRef.current, { id: offenId, gastId: gast.id, anzahl: n, eventId, zeit: jetzt() }]);
    aktualisiere(gast.id, gast.drin + n);
    setMeldung({
      art: "gut",
      text: `${n === 1 ? "1 Person" : `${n} Personen`} rein · ohne Netz gespeichert`,
      rueck: { gast, anzahl: n, offenId },
    });
  }

  async function rueckgaengig() {
    const r = meldung?.rueck;
    if (!r || laeuft) return;
    const aktuell = gaeste.find((g) => g.id === r.gast.id) ?? r.gast;
    // Noch nicht nachgetragen: einfach aus der Warteschlange nehmen.
    if (r.offenId && offenRef.current.some((o) => o.id === r.offenId)) {
      setOffen(offenRef.current.filter((o) => o.id !== r.offenId));
      aktualisiere(aktuell.id, Math.max(0, aktuell.drin - r.anzahl));
      setMeldung({ art: "schon", text: `Zurückgenommen · ${aktuell.name}` });
      return;
    }
    if (!navigator.onLine) {
      setMeldung({ art: "nein", text: "Zurücknehmen braucht Netz, der Einlass ist schon übertragen." });
      return;
    }
    setLaeuft(aktuell.id);
    const antwort = await crewGastZurueck(holeDb(), aktuell.id, r.anzahl);
    setLaeuft(null);
    if (!antwort) {
      setMeldung({ ...meldung!, art: "nein", text: "Keine Antwort. Nochmal versuchen." });
      return;
    }
    if (typeof antwort.drin === "number") aktualisiere(aktuell.id, antwort.drin, antwort.personen);
    setMeldung(
      antwort.ergebnis === "zurueck"
        ? { art: "schon", text: `${antwort.anzahl === 1 ? "1 Person" : `${antwort.anzahl} Personen`} zurückgenommen · ${aktuell.name}` }
        : antwort.ergebnis === "nicht_erlaubt"
          ? { art: "nein", text: "Zurücknehmen geht nur beim eigenen Einlass der letzten 30 Minuten." }
          : { art: "nein", text: `Nichts zurückzunehmen · ${aktuell.name}` },
    );
  }

  const offenIds = useMemo(() => new Set(offen.map((o) => o.gastId)), [offen]);
  const summe = useMemo(
    () => ({ personen: gaeste.reduce((s, g) => s + g.personen, 0), drin: gaeste.reduce((s, g) => s + g.drin, 0) }),
    [gaeste],
  );
  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return gaeste.filter((g) => {
      const rest = g.personen - g.drin;
      if (filter === "offen" && rest <= 0) return false;
      if (filter === "drin" && g.drin === 0) return false;
      return !q || g.name.toLowerCase().includes(q) || (g.notiz ?? "").toLowerCase().includes(q);
    });
  }, [gaeste, suche, filter]);

  const uhr = (t: number) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <header className="crew-titelkopf">
        <span className="crew-titel">Gästeliste</span>
        <span className="crew-titel-zahl">
          {summe.drin} von {summe.personen} drin
        </span>
      </header>

      {!online ? (
        <div role="status" className="crew-band" data-art="offline">
          <i className="ph-bold ph-wifi-slash" aria-hidden="true" />
          <span>
            {stand ? `Liste von ${uhr(stand)}.` : "Keine Liste auf dem Gerät."} Einlässe werden nachgetragen.
          </span>
        </div>
      ) : null}
      {meldung ? (
        <div role="status" className="crew-band" data-art={meldung.art === "gut" ? "gut" : meldung.art === "schon" ? "doppelt" : "abgelaufen"}>
          <i
            className={`ph-bold ${meldung.art === "gut" ? "ph-check-circle" : meldung.art === "schon" ? "ph-clock-counter-clockwise" : "ph-x-circle"}`}
            aria-hidden="true"
          />
          <span>{meldung.text}</span>
          {meldung.rueck ? (
            <button type="button" className="crew-band-aktion" onClick={() => void rueckgaengig()} disabled={laeuft !== null}>
              Rückgängig
            </button>
          ) : null}
          <button type="button" className="crew-band-aktion" onClick={() => setMeldung(null)}>
            OK
          </button>
        </div>
      ) : null}

      <div className="crew-suche">
        <span className="crew-suchfeld">
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          <input
            className="input"
            type="search"
            placeholder="Name suchen"
            aria-label="Gästeliste durchsuchen"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </span>
        <div className="seg crew-filter" role="radiogroup" aria-label="Filter">
          {(
            [
              ["alle", "Alle"],
              ["offen", "Offen"],
              ["drin", "Drin"],
            ] as const
          ).map(([wert, name]) => (
            <label key={wert} className="seg-opt">
              <input type="radio" name="crew-gaeste-filter" checked={filter === wert} onChange={() => setFilter(wert)} />
              {name}
            </label>
          ))}
        </div>
      </div>

      <ul className="crew-gaeste">
        {gaeste.length === 0 ? (
          <li className="crew-gaeste-leer">
            {online
              ? "Für dieses Event steht niemand auf der Gästeliste."
              : "Ohne Netz und ohne gespeicherte Liste. Sobald Empfang da ist, lädt sie."}
          </li>
        ) : sichtbar.length === 0 ? (
          <li className="crew-gaeste-leer">Niemand passt zur Suche.</li>
        ) : (
          sichtbar.map((g) => {
            const rest = Math.max(g.personen - g.drin, 0);
            const wartet = offenIds.has(g.id);
            return (
              <li key={g.id} className="crew-gast">
                <span className="crew-gast-text">
                  <span className="crew-gast-name">{g.name}</span>
                  <span className="crew-gast-info">
                    <span>
                      {g.drin && rest ? `${g.drin} von ${g.personen} drin` : g.personen === 1 ? "1 Person" : `${g.personen} Personen`}
                    </span>
                    {g.vip ? <span className="tag tag-accent">VIP{g.tisch ? ` · ${g.tisch}` : ""}</span> : null}
                    {g.notiz ? <span className="crew-gast-notiz">· {g.notiz}</span> : null}
                  </span>
                  {wartet || g.drin > 0 ? (
                    <span className="crew-gast-status" data-art={wartet || rest > 0 ? "teil" : "alle"}>
                      <i
                        className={`ph-bold ${wartet ? "ph-cloud-arrow-up" : rest === 0 ? "ph-check-circle" : "ph-circle-half"}`}
                        aria-hidden="true"
                      />
                      {wartet ? "Ohne Netz gespeichert" : rest === 0 ? "Alle drin" : "Teilweise drin"}
                    </span>
                  ) : null}
                </span>
                <span className="crew-gast-knoepfe">
                  <button
                    type="button"
                    className="btn btn-primary crew-gast-knopf"
                    disabled={rest === 0 || laeuft !== null}
                    onClick={() => void einlassen(g, rest)}
                  >
                    {rest === 0 ? "Drin" : laeuft === g.id ? "…" : `Einlassen · ${rest}`}
                  </button>
                  {rest > 1 ? (
                    <button
                      type="button"
                      className="btn btn-ghost crew-gast-einer"
                      disabled={laeuft !== null}
                      onClick={() => void einlassen(g, 1)}
                    >
                      Nur 1
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
