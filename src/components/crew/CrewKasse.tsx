"use client";

import { useCallback, useEffect, useState } from "react";
import type { Kassenstand } from "@/app/aktionen/kasse";
import type { KassenPhase } from "@/components/Kasse";
import { preisText } from "@/lib/format";
import { belegungsStufe, useBelegung } from "@/lib/crew/belegung";
import { crewKassenDaten, crewVerkaufAbbrechen, crewVerkaufen, crewZahlungStand } from "@/lib/crew/kasse";

type Zustand =
  | { art: "bereit" }
  | { art: "bar_bestaetigen" }
  | { art: "qr"; bestellungId: string; qr: string; gesamtCent: number; anzahl: number; einlassen: boolean }
  | { art: "fertig"; anzahl: number; gesamtCent: number; eingelassen: boolean; zahlung: "bar" | "qr"; qr: string | null }
  | { art: "abgelaufen" }
  | { art: "unklar" };

/** So oft fragt die Kasse, ob der Gast bezahlt hat. */
const ABFRAGE_MS = 2500;
const AUFFRISCHEN_MS = 60 * 1000;

const STUFE = {
  gut: { farbe: "var(--netz-gut)", icon: "ph-check-circle" },
  knapp: { farbe: "var(--netz-schwach)", icon: "ph-warning" },
  voll: { farbe: "var(--netz-aus)", icon: "ph-prohibit" },
} as const;

const euro = (cent: number) => preisText(cent, "de");

/**
 * Abendkasse der Crew-App (Design: 06 · Kasse, 07 · Karte per QR). Verkauft
 * wird genau wie an /kasse — dieselben Funktionen, nur über eine feste Route.
 * Wer sofort reingeht, zählt auf „drin“ (die Tickets werden entwertet, 0049);
 * Bar und Karte sind gesperrt, wenn weniger Plätze frei sind als verkauft
 * werden sollen.
 *
 * Ohne Netz wird nicht verkauft: Kontingent und Geld lassen sich nicht
 * nachtragen wie ein Einlass, zwei Kassen würden sonst dieselben letzten
 * Tickets verkaufen.
 */
export function CrewKasse({ eventId, online }: { eventId: string; online: boolean }) {
  const [phasen, setPhasen] = useState<KassenPhase[] | null>(null);
  const [stand, setStand] = useState<Kassenstand | null>(null);
  const [qrMoeglich, setQrMoeglich] = useState(false);
  const [keinZugang, setKeinZugang] = useState(false);
  const [phaseId, setPhaseId] = useState("");
  const [menge, setMenge] = useState(1);
  const [einlassen, setEinlassen] = useState(true);
  const [zustand, setZustand] = useState<Zustand>({ art: "bereit" });
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  // Phasen, Rest und Kassenstand: beim Start, jede Minute und nach jedem
  // Verkauf (`laden`), damit „übrig“ stimmt, wenn zwei Kassen verkaufen.
  const [ladeNr, setLadeNr] = useState(0);
  const laden = useCallback(() => setLadeNr((n) => n + 1), []);

  useEffect(() => {
    if (!online) return;
    let aktiv = true;
    const holen = async () => {
      const daten = await crewKassenDaten(eventId);
      if (!aktiv || !daten) return;
      if (daten.ergebnis === "keine_berechtigung") {
        setKeinZugang(true);
        return;
      }
      setKeinZugang(false);
      setPhasen(daten.phasen);
      setStand(daten.stand);
      setQrMoeglich(daten.qrMoeglich);
      // Die Wahl bleibt stehen, solange es die Phase noch gibt.
      setPhaseId((alt) =>
        daten.phasen.some((p) => p.id === alt) ? alt : (daten.phasen.find((p) => p.rest !== 0)?.id ?? daten.phasen[0]?.id ?? ""),
      );
    };
    void holen();
    const takt = setInterval(() => void holen(), AUFFRISCHEN_MS);
    return () => {
      aktiv = false;
      clearInterval(takt);
    };
  }, [online, eventId, ladeNr]);

  // Auf die Zahlung vom Gasthandy warten.
  useEffect(() => {
    if (zustand.art !== "qr") return;
    let aus = false;
    let uhr: ReturnType<typeof setTimeout>;
    const fragen = async () => {
      const antwort = await crewZahlungStand(zustand.bestellungId, zustand.einlassen);
      if (aus) return;
      if (antwort?.art === "bezahlt") {
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        setZustand({
          art: "fertig",
          anzahl: zustand.anzahl,
          gesamtCent: zustand.gesamtCent,
          eingelassen: zustand.einlassen && antwort.eingelassen > 0,
          zahlung: "qr",
          qr: null,
        });
        laden();
        return;
      }
      if (antwort?.art === "abgelaufen") {
        setZustand({ art: "abgelaufen" });
        laden();
        return;
      }
      uhr = setTimeout(fragen, ABFRAGE_MS);
    };
    uhr = setTimeout(fragen, ABFRAGE_MS);
    return () => {
      aus = true;
      clearTimeout(uhr);
    };
  }, [zustand, laden]);

  const belegung = useBelegung(eventId);
  const ampel = belegung ? belegungsStufe(belegung) : null;
  // Wer für später kauft, geht heute nicht rein und zählt nicht.
  const zuVoll = einlassen && ampel?.frei != null && ampel.frei < menge;

  const phase = phasen?.find((p) => p.id === phaseId);
  const summe = phase ? (phase.preis_cent + phase.gebuehr_cent) * menge : 0;
  const hoechstens = Math.max(1, Math.min(20, phase?.rest ?? 20));
  const gesperrt = laeuft || !online || !phase || phase.rest === 0 || zuVoll;

  async function verkaufen(zahlung: "bar" | "qr") {
    if (!phase || laeuft) return;
    setLaeuft(true);
    setFehler(null);
    const antwort = await crewVerkaufen({ eventId, phaseId: phase.id, menge, zahlung, einlassen });
    setLaeuft(false);

    if (!antwort) {
      // Womöglich trotzdem gebucht: nicht einfach nochmal verkaufen lassen.
      setZustand({ art: "unklar" });
      laden();
      return;
    }
    if (!antwort.ok) {
      setZustand({ art: "bereit" });
      setFehler(antwort.fehler);
      laden();
      return;
    }
    if (zahlung === "qr") {
      setZustand({
        art: "qr",
        bestellungId: antwort.bestellungId,
        qr: antwort.qr ?? "",
        gesamtCent: antwort.gesamtCent,
        anzahl: antwort.anzahl,
        einlassen,
      });
      return;
    }
    if (navigator.vibrate) navigator.vibrate(60);
    setZustand({
      art: "fertig",
      anzahl: antwort.anzahl,
      gesamtCent: antwort.gesamtCent,
      eingelassen: antwort.eingelassen,
      zahlung: "bar",
      qr: antwort.qr,
    });
    laden();
  }

  async function abbrechen() {
    if (zustand.art !== "qr") return;
    setLaeuft(true);
    await crewVerkaufAbbrechen(zustand.bestellungId);
    setLaeuft(false);
    setZustand({ art: "bereit" });
    laden();
  }

  function naechster() {
    setZustand({ art: "bereit" });
    setMenge(1);
    setEinlassen(true);
    setFehler(null);
  }

  // ---------- Karte per QR: der Bildschirm gehört dem Gast ----------
  if (zustand.art === "qr") {
    return (
      <div className="crew-kasse-qr">
        <span className="crew-kasse-qr-kopf">
          <span className="crew-titel">Gast scannt mit dem Handy</span>
          <span className="crew-kasse-qr-was">
            {zustand.anzahl} × {phase?.name ?? "Abendkasse"} · {euro(zustand.gesamtCent)}
          </span>
        </span>
        {/* Das SVG erzeugt der Server aus unserem eigenen Zahllink. */}
        <div className="crew-kasse-qr-code" role="img" aria-label="Zahlungs-QR-Code" dangerouslySetInnerHTML={{ __html: zustand.qr }} />
        <span role="status" className="crew-kasse-warte">
          <i className="ph-bold ph-circle-notch" aria-hidden="true" />
          Warte auf Zahlung …
        </span>
        <span className="crew-kasse-qr-hinweis">
          Bildschirm zum Gast drehen. Nach der Zahlung erscheint „Bezahlt“ in Grün, die Tickets gehen an die Mail des
          Gastes.
        </span>
        <button type="button" className="btn btn-secondary crew-kasse-abbrechen" onClick={() => void abbrechen()} disabled={laeuft}>
          Abbrechen
        </button>
      </div>
    );
  }

  return (
    <>
      <header className="crew-titelkopf">
        <span className="crew-titel">Abendkasse</span>
        <span className="crew-titel-zahl crew-kasse-netz" data-online={online}>
          <i className={`ph-fill ${online ? "ph-circle" : "ph-wifi-slash"}`} aria-hidden="true" />
          {online ? "Verbunden" : "Ohne Netz"}
        </span>
      </header>

      {!online ? (
        <div role="status" className="crew-band" data-art="offline">
          <i className="ph-bold ph-wifi-slash" aria-hidden="true" />
          <span>Ohne Netz kein Verkauf. Die Zahl unten ist der letzte bekannte Stand.</span>
        </div>
      ) : null}

      <div className="crew-kasse">
        {belegung && ampel ? (
          <section
            className="card elev-sm crew-kasse-belegung"
            style={{ "--stufe": STUFE[ampel.stufe].farbe } as React.CSSProperties}
            aria-live="polite"
          >
            <span className="crew-kasse-belegung-kopf">
              <span className="card-kicker">Gerade drin · live</span>
              <span className="crew-kasse-belegung-status">
                <i className={`ph-fill ${STUFE[ampel.stufe].icon}`} aria-hidden="true" />
                {ampel.frei === null ? "Ohne Grenze" : ampel.frei === 0 ? "Voll" : `Noch ${ampel.frei} frei`}
              </span>
            </span>
            <span className="crew-kasse-belegung-zahl">
              <span className="crew-kasse-belegung-wert">{belegung.drin}</span>
              {belegung.kapazitaet ? <span>von {belegung.kapazitaet}</span> : null}
            </span>
            {belegung.kapazitaet ? (
              <span className="crew-kasse-balken" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (belegung.drin / belegung.kapazitaet) * 100)}%` }} />
              </span>
            ) : null}
            <span className="crew-kasse-hinweis">Zählt nur Reingelassene. Abgewiesene zählen nicht.</span>
          </section>
        ) : null}

        <section className="card elev-sm crew-kasse-stand">
          <span className="card-kicker">Kassenstand heute</span>
          <div className="crew-kasse-stand-zahlen">
            <span>
              <span>Bar</span>
              <strong>{stand ? euro(stand.barCent) : "–"}</strong>
            </span>
            <span>
              <span>Karte</span>
              <strong>{stand ? euro(stand.qrCent) : "–"}</strong>
            </span>
            <span>
              <span>Tickets</span>
              <strong>{stand ? stand.tickets : "–"}</strong>
            </span>
          </div>
          {stand && stand.offen > 0 ? (
            <span className="crew-kasse-hinweis">
              {stand.offen === 1 ? "1 Kartenzahlung offen" : `${stand.offen} Kartenzahlungen offen`}
            </span>
          ) : null}
        </section>

        {zustand.art === "fertig" ? (
          <section className="crew-kasse-ergebnis" data-art="gut" role="status" aria-live="assertive">
            <i className="ph-fill ph-check-circle" aria-hidden="true" />
            <span className="crew-kasse-ergebnis-wort">{zustand.eingelassen ? "Drin" : "Bezahlt"}</span>
            <span className="crew-kasse-ergebnis-text">
              {zustand.anzahl === 1 ? "1 Ticket" : `${zustand.anzahl} Tickets`} · {euro(zustand.gesamtCent)}{" "}
              {zustand.zahlung === "bar" ? "bar" : "mit Karte"}
              {zustand.eingelassen ? " · eingelassen und gezählt" : ""}
            </span>
            {zustand.qr ? (
              <>
                <span className="crew-kasse-ergebnis-text">Tickets für später: Der Gast fotografiert den Code oder scannt ihn.</span>
                <div className="crew-kasse-qr-code" dangerouslySetInnerHTML={{ __html: zustand.qr }} />
              </>
            ) : null}
            <button type="button" className="btn crew-kasse-weiter" onClick={naechster}>
              Nächster Gast
            </button>
          </section>
        ) : zustand.art === "abgelaufen" || zustand.art === "unklar" ? (
          <section className="crew-kasse-ergebnis" data-art="nein" role="alert">
            <i className="ph-fill ph-warning-circle" aria-hidden="true" />
            <span className="crew-kasse-ergebnis-wort">{zustand.art === "unklar" ? "Keine Antwort" : "Nicht bezahlt"}</span>
            <span className="crew-kasse-ergebnis-text">
              {zustand.art === "unklar"
                ? "Unklar, ob der Verkauf gebucht ist. Erst den Kassenstand oben ansehen, dann neu verkaufen."
                : "Die Zahlung kam nicht innerhalb von 20 Minuten. Die Tickets sind wieder frei."}
            </span>
            <button type="button" className="btn crew-kasse-weiter" onClick={naechster}>
              Zurück
            </button>
          </section>
        ) : keinZugang ? (
          <p className="crew-kasse-leer">Verkaufen dürfen nur Kasse und Admin. Ist die Anmeldung älter als 8 Stunden, bitte neu anmelden.</p>
        ) : phasen === null ? (
          <p className="crew-kasse-leer">{online ? "Kasse lädt …" : "Die Kasse braucht Netz."}</p>
        ) : phasen.length === 0 ? (
          <p className="crew-kasse-leer">
            Für dieses Event gibt es keine Abendkassen-Phase. Im Backoffice beim Event eine Phase anlegen und „Nur an der
            Abendkasse“ ankreuzen.
          </p>
        ) : (
          <>
            <div className="field">
              <span className="crew-kasse-label">Ticket</span>
              <div className="seg crew-kasse-phasen" role="radiogroup" aria-label="Ticket">
                {phasen.map((p) => (
                  <label key={p.id} className="seg-opt" data-aus={p.rest === 0 || undefined}>
                    <input
                      type="radio"
                      name="crew-kasse-phase"
                      checked={p.id === phaseId}
                      disabled={p.rest === 0}
                      onChange={() => {
                        setPhaseId(p.id);
                        setMenge(1);
                      }}
                    />
                    <span className="crew-kasse-phase-name">{p.name}</span>
                    <span className="crew-kasse-phase-preis">
                      {euro(p.preis_cent + p.gebuehr_cent)}
                      {p.rest === 0 ? " · ausverkauft" : p.rest !== null && p.rest <= 20 ? ` · ${p.rest} übrig` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="crew-kasse-label">Anzahl</span>
              <div className="crew-kasse-menge">
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label="Eins weniger"
                  onClick={() => setMenge((m) => Math.max(1, m - 1))}
                  disabled={menge <= 1}
                >
                  <i className="ph-bold ph-minus" aria-hidden="true" />
                </button>
                <output aria-live="polite">{menge}</output>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label="Eins mehr"
                  onClick={() => setMenge((m) => Math.min(hoechstens, m + 1))}
                  disabled={menge >= hoechstens}
                >
                  <i className="ph-bold ph-plus" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="seg crew-kasse-wann" role="radiogroup" aria-label="Wann geht der Gast rein">
              <label className="seg-opt">
                <input type="radio" name="crew-kasse-wann" checked={einlassen} onChange={() => setEinlassen(true)} />
                Geht jetzt rein
              </label>
              <label className="seg-opt">
                <input type="radio" name="crew-kasse-wann" checked={!einlassen} onChange={() => setEinlassen(false)} />
                Für später
              </label>
            </div>

            <div className="crew-kasse-summe">
              <span>Zu zahlen</span>
              <strong>{euro(summe)}</strong>
            </div>

            {fehler ? (
              <p className="crew-fehler" role="alert">
                {fehler}
              </p>
            ) : zuVoll ? (
              <p className="crew-fehler" role="alert">
                {ampel?.frei === 0 ? "Voll." : `Nur noch ${ampel?.frei} frei.`} Weniger Tickets wählen oder „Für später“.
              </p>
            ) : null}

            {zustand.art === "bar_bestaetigen" ? (
              <div className="crew-kasse-wege">
                <button type="button" className="btn btn-secondary" onClick={() => setZustand({ art: "bereit" })} disabled={laeuft}>
                  Zurück
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void verkaufen("bar")} disabled={gesperrt}>
                  <i className="ph-bold ph-check" aria-hidden="true" />
                  {laeuft ? "Bucht …" : `${euro(summe)} erhalten`}
                </button>
              </div>
            ) : (
              <div className="crew-kasse-wege">
                <button type="button" className="btn btn-primary" onClick={() => setZustand({ art: "bar_bestaetigen" })} disabled={gesperrt}>
                  <i className="ph-bold ph-money" aria-hidden="true" />
                  Bar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void verkaufen("qr")}
                  disabled={gesperrt || !qrMoeglich}
                  title={qrMoeglich ? undefined : "Kartenzahlung geht, sobald Stripe eingerichtet ist."}
                >
                  <i className="ph-bold ph-qr-code" aria-hidden="true" />
                  {laeuft ? "…" : "Karte"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
