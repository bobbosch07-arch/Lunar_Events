"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { ROLLEN_NAMEN } from "@/lib/rollen";
import { ABLAGE, lies, schreib } from "@/lib/crew/ablage";
import { crewMeineSchichten, type CrewSchicht } from "@/lib/crew/plan";
import { CrewTeam } from "./CrewTeam";

const AUFFRISCHEN_MS = 5 * 60 * 1000;
const ZONE = "Europe/Berlin";

const uhr = (iso: string | number) =>
  new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: ZONE });
const wochentag = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { weekday: "short", timeZone: ZONE }).replace(".", "");
const tag = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", timeZone: ZONE });
const datum = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: ZONE });
const stunden = (n: number) => n.toFixed(2).replace(".", ",").replace(/,00$/, "");
const jetzt = () => Date.now();

/**
 * „Mein Plan“ der Crew-App (Design: 10 · Mein Plan) — für jeden aus dem
 * Team, auch für Rollen ohne Scanner. Oben die laufende oder nächste
 * Schicht, darunter die weiteren.
 *
 * Ein- und Auschecken macht weiter der Admin für alle (0023); hier wird es
 * nur angezeigt. Die Pause steht als Dauer im Plan, nicht als Uhrzeit, und
 * statt „Leitung“ zeigt die Karte die Notiz der Schicht (entschieden 30.10.).
 *
 * Ohne Netz gilt der zuletzt geladene Plan aus der Ablage.
 */
export function CrewPlan({
  online,
  abmelden,
  teamEventId,
}: {
  online: boolean;
  abmelden: () => void;
  /** Nur beim Admin: dessen Team wird hier ein- und ausgecheckt. */
  teamEventId?: string;
}) {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const [schichten, setSchichten] = useState<CrewSchicht[] | null>(null);
  const [stand, setStand] = useState<number | null>(null);
  const [zeit, setZeit] = useState(jetzt);

  // Gespeicherten Plan sofort zeigen, auch ohne Netz.
  useEffect(() => {
    let aktiv = true;
    void lies<{ schichten: CrewSchicht[]; stand: number } | null>(ABLAGE.plan, null).then((g) => {
      if (aktiv && g) {
        setSchichten((alt) => alt ?? g.schichten);
        setStand((alt) => alt ?? g.stand);
      }
    });
    return () => {
      aktiv = false;
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    let aktiv = true;
    const holen = async () => {
      const neu = await crewMeineSchichten((db.current ??= browserClient()));
      if (!aktiv || !neu) return;
      const t = jetzt();
      setSchichten(neu);
      setStand(t);
      setZeit(t);
      void schreib(ABLAGE.plan, { schichten: neu, stand: t });
    };
    void holen();
    const takt = setInterval(() => void holen(), AUFFRISCHEN_MS);
    return () => {
      aktiv = false;
      clearInterval(takt);
    };
  }, [online]);

  // Damit „Jetzt“ ohne Neuladen von einer Schicht zur nächsten springt.
  useEffect(() => {
    const takt = setInterval(() => setZeit(jetzt()), 60_000);
    return () => clearInterval(takt);
  }, []);

  const { naechste, weitere, gearbeitet } = useMemo(() => {
    const liste = schichten ?? [];
    const kommend = liste.filter((s) => new Date(s.ende).getTime() >= zeit);
    const vorbei = liste.filter((s) => new Date(s.ende).getTime() < zeit);
    return {
      naechste: kommend[0] ?? null,
      weitere: kommend.slice(1),
      gearbeitet: { anzahl: vorbei.length, stunden: vorbei.reduce((s, x) => s + Number(x.stunden), 0) },
    };
  }, [schichten, zeit]);

  const laeuft = naechste ? new Date(naechste.beginn).getTime() <= zeit : false;

  return (
    <>
      <header className="crew-titelkopf">
        <span className="crew-titel">Mein Plan</span>
        <button type="button" className="btn btn-ghost crew-plan-abmelden" onClick={abmelden}>
          <i className="ph-bold ph-sign-out" aria-hidden="true" />
          Abmelden
        </button>
      </header>

      {!online ? (
        <div role="status" className="crew-band" data-art="offline">
          <i className="ph-bold ph-wifi-slash" aria-hidden="true" />
          <span>{stand ? `Plan von ${datum(new Date(stand).toISOString())}, ${uhr(stand)}.` : "Noch kein Plan auf dem Gerät."}</span>
        </div>
      ) : null}

      <div className="crew-plan">
        {schichten === null ? (
          <p className="crew-kasse-leer">{online ? "Plan lädt …" : "Einmal mit Netz öffnen, dann steht der Plan auch ohne."}</p>
        ) : !naechste ? (
          <p className="crew-kasse-leer">
            Für dich ist gerade keine Schicht eingetragen. Sobald eingeteilt wird, steht sie hier, und du bekommst eine Mail.
          </p>
        ) : (
          <section className="card elev-md crew-plan-jetzt" data-laeuft={laeuft || undefined}>
            <span className="crew-plan-jetzt-kopf">
              <span className="card-kicker">{laeuft ? "Jetzt" : "Als Nächstes"}</span>
              {naechste.ausgecheckt_am ? (
                <span className="tag tag-neutral">Ausgecheckt {uhr(naechste.ausgecheckt_am)}</span>
              ) : naechste.eingecheckt_am ? (
                <span className="tag crew-plan-drin">
                  <i className="ph-bold ph-check" aria-hidden="true" />
                  Eingecheckt {uhr(naechste.eingecheckt_am)}
                </span>
              ) : null}
            </span>
            <span className="crew-plan-rolle">{ROLLEN_NAMEN[naechste.rolle] ?? naechste.rolle}</span>
            <dl className="crew-plan-daten">
              <dt>Event</dt>
              <dd>
                {naechste.event.titel}
                {naechste.event.ort ? <span className="crew-plan-ort">{naechste.event.ort}</span> : null}
              </dd>
              <dt>Zeit</dt>
              <dd className="crew-plan-zahl">
                {laeuft ? "" : `${datum(naechste.beginn)}, `}
                {uhr(naechste.beginn)} – {uhr(naechste.ende)}
              </dd>
              {naechste.station ? (
                <>
                  <dt>Station</dt>
                  <dd>{naechste.station}</dd>
                </>
              ) : null}
              <dt>Pause</dt>
              <dd className="crew-plan-zahl">{naechste.pause_min ? `${naechste.pause_min} Min` : "keine"}</dd>
              {naechste.notiz ? (
                <>
                  <dt>Notiz</dt>
                  <dd className="crew-plan-notiz">{naechste.notiz}</dd>
                </>
              ) : null}
            </dl>
          </section>
        )}

        {weitere.length > 0 ? (
          <section className="crew-plan-weitere">
            <h2 className="crew-plan-ueber">Nächste Schichten</h2>
            <ul>
              {weitere.map((s) => (
                <li key={s.id} className="crew-plan-zeile">
                  <span className="crew-plan-tag">
                    <span>{wochentag(s.beginn)}</span>
                    <strong>{tag(s.beginn)}</strong>
                  </span>
                  <span className="crew-plan-zeile-text">
                    <span className="crew-plan-zeile-titel">
                      {ROLLEN_NAMEN[s.rolle] ?? s.rolle} · {s.event.titel}
                    </span>
                    <span className="crew-plan-zeile-unter">
                      {uhr(s.beginn)} – {uhr(s.ende)}
                      {s.pause_min ? ` · Pause ${s.pause_min} Min` : ""}
                      {s.station ? ` · ${s.station}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {teamEventId ? <CrewTeam key={teamEventId} eventId={teamEventId} online={online} /> : null}

        {gearbeitet.anzahl > 0 ? (
          <p className="crew-plan-stunden">
            Gearbeitet: {stunden(gearbeitet.stunden)} Std in {gearbeitet.anzahl === 1 ? "einer Schicht" : `${gearbeitet.anzahl} Schichten`}.
            Gezählt wird, was der Admin am Abend ein- und auscheckt, sonst die geplante Zeit, Pause immer abgezogen.
          </p>
        ) : null}
      </div>
    </>
  );
}
