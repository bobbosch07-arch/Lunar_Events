"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  brecheTuerVerkaufAb,
  holeKassenstand,
  pruefeTuerZahlung,
  verkaufeAnDerTuer,
  type Kassenstand,
} from "@/app/aktionen/kasse";
import { preisText } from "@/lib/format";
import { useRouter } from "@/i18n/navigation";
import css from "./Kasse.module.css";

export type KassenPhase = {
  id: string;
  name: string;
  preis_cent: number;
  gebuehr_cent: number;
  /** Übrig im Kontingent, null = unbegrenzt */
  rest: number | null;
};

export type KassenEvent = { id: string; titel: string; wann: string; phasen: KassenPhase[] };

type Zustand =
  | { art: "bereit" }
  | { art: "fertig"; anzahl: number; nummer: string; eingelassen: boolean; qr: string | null }
  | { art: "qr"; bestellungId: string; qr: string; gesamtCent: number; einlassen: boolean }
  | { art: "abgelaufen" };

/** So oft fragt die Kasse, ob der Gast bezahlt hat. */
const ABFRAGE_MS = 2500;

/**
 * Die Abendkasse (0025): Phase wählen, Menge, dann bar oder per QR am
 * Gasthandy. Nach dem Verkauf ist die Person sofort drin — sie steht ja vor
 * einem (Rückfrage 17.09.2026). Wer für später kauft, nimmt das Häkchen raus
 * und bekommt seine Tickets als QR-Code zum Abfotografieren.
 */
export function Kasse({
  events,
  qrMoeglich,
}: {
  events: KassenEvent[];
  /** Stripe eingerichtet — sonst gibt es nur Bargeld. */
  qrMoeglich: boolean;
}) {
  const [eventId, setEventId] = useState(events[0]?.id ?? "");
  const event = events.find((e) => e.id === eventId);
  const [phaseId, setPhaseId] = useState(event?.phasen[0]?.id ?? "");
  const phase = event?.phasen.find((p) => p.id === phaseId);
  const [menge, setMenge] = useState(1);
  const [einlassen, setEinlassen] = useState(true);
  const [zustand, setZustand] = useState<Zustand>({ art: "bereit" });
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [stand, setStand] = useState<Kassenstand | null>(null);
  const abfrage = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Kassenstand und Restmengen neu holen — nach jedem Verkauf, damit die
  // Anzeige „übrig“ nicht hinterherhinkt, wenn zwei Kassen verkaufen.
  const standLaden = useCallback(async () => {
    if (!eventId) return;
    setStand(await holeKassenstand(eventId));
    router.refresh();
  }, [eventId, router]);

  useEffect(() => {
    void standLaden();
  }, [standLaden]);

  // Beim Eventwechsel die erste Phase vorwählen. Nach einem Auffrischen
  // bleibt die Wahl stehen, solange es die Phase noch gibt.
  useEffect(() => {
    const phasen = events.find((e) => e.id === eventId)?.phasen ?? [];
    setPhaseId((alt) => (phasen.some((p) => p.id === alt) ? alt : (phasen[0]?.id ?? "")));
  }, [eventId, events]);

  // Auf die Zahlung vom Gasthandy warten.
  useEffect(() => {
    if (zustand.art !== "qr") return;
    let aus = false;
    const fragen = async () => {
      const antwort = await pruefeTuerZahlung(zustand.bestellungId, zustand.einlassen).catch(
        () => ({ art: "wartet" as const }),
      );
      if (aus) return;
      if (antwort.art === "bezahlt") {
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        setZustand({
          art: "fertig",
          anzahl: menge,
          nummer: "",
          eingelassen: zustand.einlassen,
          qr: null,
        });
        void standLaden();
        return;
      }
      if (antwort.art === "abgelaufen") {
        setZustand({ art: "abgelaufen" });
        return;
      }
      abfrage.current = setTimeout(fragen, ABFRAGE_MS);
    };
    abfrage.current = setTimeout(fragen, ABFRAGE_MS);
    return () => {
      aus = true;
      if (abfrage.current) clearTimeout(abfrage.current);
    };
  }, [zustand, menge, standLaden]);

  const summe = phase ? (phase.preis_cent + phase.gebuehr_cent) * menge : 0;
  const hoechstens = Math.min(20, phase?.rest ?? 20);

  async function verkaufen(zahlung: "bar" | "qr") {
    if (!phase || laeuft) return;
    if (zahlung === "bar" && !window.confirm(`${preisText(summe, "de")} bar kassiert?`)) return;
    setLaeuft(true);
    setFehler(null);
    const antwort = await verkaufeAnDerTuer({
      eventId,
      phaseId: phase.id,
      menge,
      zahlung,
      einlassen,
    }).catch(() => ({ ok: false as const, fehler: "Keine Verbindung. Nochmal versuchen." }));
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.fehler);
      return;
    }
    if (zahlung === "qr") {
      setZustand({
        art: "qr",
        bestellungId: antwort.bestellungId,
        qr: antwort.qr ?? "",
        gesamtCent: antwort.gesamtCent,
        einlassen,
      });
      return;
    }
    if (navigator.vibrate) navigator.vibrate(60);
    setZustand({
      art: "fertig",
      anzahl: antwort.anzahl,
      nummer: antwort.nummer,
      eingelassen: antwort.eingelassen,
      qr: antwort.qr,
    });
    void standLaden();
  }

  async function abbrechen() {
    if (zustand.art !== "qr") return;
    await brecheTuerVerkaufAb(zustand.bestellungId);
    setZustand({ art: "bereit" });
    void standLaden();
  }

  function naechster() {
    setZustand({ art: "bereit" });
    setMenge(1);
    setEinlassen(true);
    setFehler(null);
  }

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <select
          className={css.eventwahl}
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          aria-label="Event"
          disabled={zustand.art === "qr"}
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.titel} · {e.wann}
            </option>
          ))}
        </select>
      </header>

      <main className={css.inhalt}>
        {zustand.art === "fertig" ? (
          <div className={`${css.ergebnis} ${css.gut}`} role="status" aria-live="assertive">
            <span className={css.urteil}>{zustand.eingelassen ? "Rein" : "Verkauft"}</span>
            <span className={css.nebensache}>
              {zustand.anzahl} {zustand.anzahl === 1 ? "Ticket" : "Tickets"}
              {zustand.nummer ? ` · ${zustand.nummer}` : ""}
              {zustand.eingelassen ? " · eingelassen" : ""}
            </span>
            {zustand.qr ? (
              <>
                <span className={css.nebensache}>
                  Tickets für später: Der Gast fotografiert den Code oder scannt ihn.
                </span>
                <div className={css.qr} dangerouslySetInnerHTML={{ __html: zustand.qr }} />
              </>
            ) : null}
            <button type="button" className={css.textknopf} onClick={naechster}>
              Nächster Gast
            </button>
          </div>
        ) : zustand.art === "qr" ? (
          <div className={`${css.ergebnis} ${css.warte}`} role="status" aria-live="polite">
            <span className={css.urteil}>{preisText(zustand.gesamtCent, "de")}</span>
            <span className={css.nebensache}>
              Gast scannt den Code und zahlt am eigenen Handy — mit Karte, Apple Pay oder
              Google Pay. Diese Seite springt um, sobald das Geld da ist.
            </span>
            {/* Das SVG erzeugt der Server aus unserem eigenen Link. */}
            <div className={css.qr} dangerouslySetInnerHTML={{ __html: zustand.qr }} />
            <button type="button" className={css.textknopf} onClick={abbrechen}>
              Abbrechen — Tickets freigeben
            </button>
          </div>
        ) : zustand.art === "abgelaufen" ? (
          <div className={`${css.ergebnis} ${css.schlecht}`} role="alert">
            <span className={css.urteil}>Nicht bezahlt</span>
            <span className={css.nebensache}>
              Die Zahlung kam nicht innerhalb von 20 Minuten. Die Tickets sind wieder frei.
            </span>
            <button type="button" className={css.textknopf} onClick={naechster}>
              Zurück
            </button>
          </div>
        ) : !event || event.phasen.length === 0 ? (
          <p className={css.leer}>
            Für dieses Event gibt es keine Abendkassen-Phase. Im Backoffice beim Event eine
            Phase anlegen und „Nur an der Abendkasse" ankreuzen.
          </p>
        ) : (
          <>
            <div className={css.phasen} role="group" aria-label="Phase">
              {event.phasen.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={css.phase}
                  aria-pressed={p.id === phaseId}
                  disabled={p.rest === 0}
                  onClick={() => {
                    setPhaseId(p.id);
                    setMenge(1);
                  }}
                >
                  <span className={css.phaseName}>
                    {p.name}
                    <span className={css.phaseRest}>
                      {p.rest === null ? "ohne Grenze" : p.rest === 0 ? "ausverkauft" : `${p.rest} übrig`}
                    </span>
                  </span>
                  <span className={css.phasePreis}>
                    {preisText(p.preis_cent + p.gebuehr_cent, "de")}
                  </span>
                </button>
              ))}
            </div>

            <div className={css.menge}>
              <span className={css.beschriftung}>Tickets</span>
              <div className={css.mengeKnoepfe}>
                <button
                  type="button"
                  className={css.mengeKnopf}
                  onClick={() => setMenge((m) => Math.max(1, m - 1))}
                  disabled={menge <= 1}
                  aria-label="Eines weniger"
                >
                  −
                </button>
                <span className={css.mengeWert} aria-live="polite">
                  {menge}
                </span>
                <button
                  type="button"
                  className={css.mengeKnopf}
                  onClick={() => setMenge((m) => Math.min(hoechstens, m + 1))}
                  disabled={menge >= hoechstens}
                  aria-label="Eines mehr"
                >
                  +
                </button>
              </div>
            </div>

            <div className={css.summe}>{preisText(summe, "de")}</div>

            <label className={css.schalter}>
              <input
                type="checkbox"
                checked={einlassen}
                onChange={(e) => setEinlassen(e.target.checked)}
              />
              Sofort einlassen
            </label>

            {fehler ? (
              <p className={css.fehler} role="alert">
                {fehler}
              </p>
            ) : null}

            <div className={css.wege}>
              <button
                type="button"
                className={`${css.weg} ${css.bar}`}
                disabled={laeuft || !phase || phase.rest === 0}
                onClick={() => verkaufen("bar")}
              >
                {laeuft ? "…" : "Bar"}
              </button>
              {qrMoeglich ? (
                <button
                  type="button"
                  className={`${css.weg} ${css.qrWeg}`}
                  disabled={laeuft || !phase || phase.rest === 0}
                  onClick={() => verkaufen("qr")}
                >
                  {laeuft ? "…" : "QR · Handy"}
                </button>
              ) : (
                <span className={css.leer}>
                  QR-Zahlung geht, sobald Stripe eingerichtet ist.
                </span>
              )}
            </div>
          </>
        )}
      </main>

      <footer className={css.stand}>
        {stand ? (
          <>
            <span>
              <strong>{stand.tickets}</strong> verkauft
            </span>
            <span>
              Bar <strong>{preisText(stand.barCent, "de")}</strong>
            </span>
            <span>
              QR <strong>{preisText(stand.qrCent, "de")}</strong>
            </span>
            {stand.offen > 0 ? <span>{stand.offen} Zahlung offen</span> : null}
          </>
        ) : (
          <span>Kassenstand lädt …</span>
        )}
      </footer>
    </div>
  );
}
