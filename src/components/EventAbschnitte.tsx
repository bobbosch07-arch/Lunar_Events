"use client";

import { useState } from "react";
import { EventFormular } from "./EventFormular";
import { EVENT_ABSCHNITTE, type EventAbschnitt, type EventStand, type OrtWahl } from "@/lib/event-stand";
import fo from "./EventFormular.module.css";
import bo from "@/app/[locale]/backoffice/backoffice.module.css";

/**
 * Die Abschnitte eines bestehenden Events als Karten (13.10.2026): erst
 * lesen, dann gezielt einen Abschnitt bearbeiten. Gespeichert werden nur
 * dessen Felder (speichereEventTeil). Immer nur ein Abschnitt ist offen,
 * damit niemand zwei halbe Änderungen nebeneinander stehen hat.
 */
export function EventAbschnitte({
  start,
  orte,
  zusammenfassung,
}: {
  start: EventStand;
  orte: OrtWahl[];
  /** Je Abschnitt die Zeilen zum Lesen, auf dem Server formatiert. */
  zusammenfassung: Record<EventAbschnitt, Array<[string, string]>>;
}) {
  const [offen, setOffen] = useState<EventAbschnitt | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 940 }}>
      {EVENT_ABSCHNITTE.map(({ id, titel }) =>
        offen === id ? (
          <EventFormular key={id} start={start} orte={orte} nur={id} onFertig={() => setOffen(null)} />
        ) : (
          <section key={id} className={fo.gruppe}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 className={fo.gruppenTitel}>{titel}</h2>
              <button
                type="button"
                className={bo.textknopf}
                disabled={offen !== null}
                title={offen !== null ? "Erst den offenen Abschnitt speichern oder abbrechen" : undefined}
                onClick={() => setOffen(id)}
              >
                Bearbeiten
              </button>
            </div>
            <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr", gap: "6px 16px", margin: 0 }}>
              {zusammenfassung[id].map(([name, wert]) => (
                <div key={name} style={{ display: "contents" }}>
                  <dt className={fo.beschriftung} style={{ alignSelf: "baseline" }}>{name}</dt>
                  <dd style={{ margin: 0, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{wert || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        ),
      )}
    </div>
  );
}
