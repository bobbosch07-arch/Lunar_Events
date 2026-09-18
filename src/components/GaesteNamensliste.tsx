"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  holeGaesteliste,
  lasseGastEin,
  type GastEinlass,
  type GastEintrag,
} from "@/app/aktionen/einlass";
import css from "./EinlassScanner.module.css";

const SPEICHER_LISTE = "lunar.einlass.gaeste";
const SPEICHER_PUFFER = "lunar.einlass.gaestepuffer";

type Gepuffert = { gastId: string; anzahl: number; zeit: number };
type Meldung = { klasse: string; text: string; detail?: string };

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
    // Voller oder gesperrter Speicher: dann eben ohne.
  }
}

/**
 * Die Gästeliste am Einlass (0021). Wer nicht per QR reinkommt, wird hier
 * abgehakt — entwertet werden dieselben Tickets wie beim Scan.
 *
 * Ohne Netz wie der Scanner: Die Liste des gewählten Events liegt auf dem
 * Gerät (nur Name, Notiz, Personenzahl — keine Adressen), Einlässe werden
 * gepuffert und nachgereicht. Beim Nachreichen zählt die Datenbank: mehr als
 * die Personen eines Eintrags kommen nie rein, auch wenn zwei Geräte
 * gleichzeitig abhaken.
 */
export function GaesteNamensliste({
  eventId,
  online,
  eingelassen,
}: {
  eventId: string;
  online: boolean;
  /** Meldet dem Scanner, wie viele gerade reingekommen sind (für den Zähler). */
  eingelassen: (anzahl: number) => void;
}) {
  const [gaeste, setGaeste] = useState<GastEintrag[]>([]);
  const [puffer, setPuffer] = useState<Gepuffert[]>([]);
  const [suche, setSuche] = useState("");
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  // Zählt hoch, wenn Nachreichen erneut versucht werden soll.
  const [versuch, setVersuch] = useState(0);

  // Gespeicherten Stand sofort zeigen — auch ohne Netz.
  useEffect(() => {
    const gespeichert = lies<{ eventId: string; gaeste: GastEintrag[] } | null>(SPEICHER_LISTE, null);
    setGaeste(gespeichert?.eventId === eventId ? gespeichert.gaeste : []);
    setPuffer(lies<Gepuffert[]>(SPEICHER_PUFFER, []));
  }, [eventId]);

  const laden = useCallback(async () => {
    const { ok, gaeste: neu } = await holeGaesteliste(eventId);
    if (!ok) return;
    setGaeste(neu);
    // Nur das gewählte Event liegt auf dem Gerät, nie alle.
    schreib(SPEICHER_LISTE, { eventId, gaeste: neu });
  }, [eventId]);

  useEffect(() => {
    if (online) void laden();
  }, [online, laden]);

  // Gepufferte Einlässe nachreichen, dann frisch laden. Klappt es nicht,
  // in 20 Sekunden noch einmal — nicht sofort, sonst hämmert das Gerät bei
  // Funkloch-Empfang in Schleife auf den Server.
  useEffect(() => {
    const offen = lies<Gepuffert[]>(SPEICHER_PUFFER, []);
    if (!online || offen.length === 0) return;
    let abgebrochen = false;
    let wiederholen: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const uebrig: Gepuffert[] = [];
      for (const eintrag of offen) {
        try {
          await lasseGastEin(eintrag.gastId, eintrag.anzahl);
        } catch {
          uebrig.push(eintrag);
        }
      }
      // Was während des Nachreichens dazukam, bleibt stehen.
      const dazu = lies<Gepuffert[]>(SPEICHER_PUFFER, []).slice(offen.length);
      const neu = [...uebrig, ...dazu];
      schreib(SPEICHER_PUFFER, neu);
      if (abgebrochen) return;
      setPuffer(neu);
      if (uebrig.length > 0) wiederholen = setTimeout(() => setVersuch((v) => v + 1), 20000);
      else void laden();
    })();
    return () => {
      abgebrochen = true;
      if (wiederholen) clearTimeout(wiederholen);
    };
  }, [online, laden, versuch]);

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase();
    const liste = s
      ? gaeste.filter(
          (g) => g.name.toLowerCase().includes(s) || (g.notiz ?? "").toLowerCase().includes(s),
        )
      : gaeste;
    return liste;
  }, [gaeste, suche]);

  const summe = useMemo(
    () => ({
      personen: gaeste.reduce((s, g) => s + g.personen, 0),
      drin: gaeste.reduce((s, g) => s + g.drin, 0),
    }),
    [gaeste],
  );

  function aktualisiere(id: string, drin: number, personen?: number) {
    setGaeste((alt) => {
      const neu = alt.map((g) =>
        g.id === id ? { ...g, drin, personen: personen ?? g.personen } : g,
      );
      schreib(SPEICHER_LISTE, { eventId, gaeste: neu });
      return neu;
    });
  }

  async function einlassen(gast: GastEintrag, anzahl: number) {
    if (navigator.vibrate) navigator.vibrate(40);
    setLaeuft(true);
    setOffen(null);

    const offline = () => {
      const rest = Math.max(gast.personen - gast.drin, 0);
      const n = Math.min(anzahl, rest);
      if (n === 0) {
        setMeldung({ klasse: css.schon_entwertet, text: "Schon drin", detail: gast.name });
        return;
      }
      const neu = [...lies<Gepuffert[]>(SPEICHER_PUFFER, []), { gastId: gast.id, anzahl: n, zeit: Date.now() }];
      setPuffer(neu);
      schreib(SPEICHER_PUFFER, neu);
      // Mit Netz, aber der Server war nicht erreichbar: bald erneut versuchen.
      if (navigator.onLine) setTimeout(() => setVersuch((v) => v + 1), 20000);
      aktualisiere(gast.id, gast.drin + n);
      eingelassen(n);
      setMeldung({
        klasse: css.gueltig,
        text: n === 1 ? "1 rein (offline)" : `${n} rein (offline)`,
        detail: `${gast.name} · ${gast.drin + n} von ${gast.personen} drin · wird nachgetragen`,
      });
    };

    if (!navigator.onLine) {
      offline();
      setLaeuft(false);
      return;
    }

    let antwort: GastEinlass;
    try {
      antwort = await lasseGastEin(gast.id, anzahl);
    } catch {
      offline();
      setLaeuft(false);
      return;
    }
    setLaeuft(false);

    if (antwort.ergebnis === "gueltig") {
      aktualisiere(gast.id, antwort.drin ?? gast.drin, antwort.personen);
      eingelassen(antwort.eingelassen ?? 0);
      setMeldung({
        klasse: css.gueltig,
        text: antwort.eingelassen === 1 ? "1 rein" : `${antwort.eingelassen} rein`,
        detail: `${gast.name} · ${antwort.drin} von ${antwort.personen} drin`,
      });
    } else if (antwort.ergebnis === "schon_drin") {
      aktualisiere(gast.id, antwort.drin ?? gast.drin, antwort.personen);
      setMeldung({
        klasse: css.schon_entwertet,
        text: "Schon drin",
        detail: `${gast.name} · alle ${antwort.personen} drin`,
      });
    } else {
      setMeldung({
        klasse: css.storniert,
        text: antwort.ergebnis === "storniert" ? "Nicht mehr auf der Liste" : "Nicht berechtigt",
        detail: gast.name,
      });
      void laden();
    }
  }

  return (
    <div className={css.liste}>
      <div className={css.listeKopf}>
        <input
          className={css.codefeld}
          style={{ textTransform: "none", letterSpacing: 0 }}
          placeholder="Name suchen …"
          aria-label="Gästeliste durchsuchen"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <span className={css.listeSumme}>
          {summe.drin} / {summe.personen} drin
          {puffer.length > 0 ? ` · ${puffer.length} nachzutragen` : ""}
        </span>
      </div>

      {meldung ? (
        <div className={`${css.listeMeldung} ${meldung.klasse}`} role="status" aria-live="assertive">
          <span className={css.listeUrteil}>{meldung.text}</span>
          {meldung.detail ? <span className={css.nebensache}>{meldung.detail}</span> : null}
        </div>
      ) : null}

      {gaeste.length === 0 ? (
        <p className={css.wartet} style={{ padding: "var(--space-6) var(--space-5)" }}>
          {online
            ? "Für dieses Event steht niemand auf der Gästeliste."
            : "Ohne Netz und ohne gespeicherte Liste — sobald Empfang da ist, lädt sie."}
        </p>
      ) : (
        <ul className={css.gaeste}>
          {sichtbar.map((g) => {
            const rest = Math.max(g.personen - g.drin, 0);
            return (
              <li key={g.id} className={css.gast}>
                <button
                  type="button"
                  className={css.gastZeile}
                  aria-expanded={offen === g.id}
                  onClick={() => setOffen(offen === g.id ? null : g.id)}
                  disabled={laeuft}
                >
                  <span className={css.gastName}>
                    {g.name}
                    {/* VIP-Gäste (0028) stehen mit auf der Liste, mit ihrem Platz. */}
                    {g.vip ? (
                      <span className={css.nebensache}>VIP{g.tisch ? ` · ${g.tisch}` : ""}</span>
                    ) : null}
                    {g.notiz ? <span className={css.nebensache}>{g.notiz}</span> : null}
                  </span>
                  <span className={`${css.gastStand} ${rest === 0 ? css.gastFertig : ""}`}>
                    {g.drin}/{g.personen}
                  </span>
                </button>
                {offen === g.id ? (
                  <div className={css.gastAktionen}>
                    {rest === 0 ? (
                      <span className={css.nebensache}>Alle {g.personen} sind drin.</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={css.gastKnopf}
                          disabled={laeuft}
                          onClick={() => einlassen(g, 1)}
                        >
                          1 rein
                        </button>
                        {rest > 1 ? (
                          <button
                            type="button"
                            className={css.gastKnopf}
                            disabled={laeuft}
                            onClick={() => einlassen(g, rest)}
                          >
                            Alle {rest} rein
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
