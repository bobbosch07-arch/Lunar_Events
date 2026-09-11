"use client";

import { useState, useTransition } from "react";
import { Knopf } from "./Knopf";
import { raeumeReservierungenAuf } from "@/app/aktionen/backoffice";

/**
 * Gibt Kontingente aus verfallenen Reservierungen frei.
 *
 * Eigentlich Aufgabe eines geplanten Auftrags. Solange es den nicht gibt,
 * ist ein Knopf ehrlicher als blockierte Plätze, die niemand bemerkt.
 */
export function Aufraeumknopf() {
  const [laeuft, starte] = useTransition();
  const [ergebnis, setErgebnis] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {ergebnis ? (
        <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          {ergebnis}
        </span>
      ) : null}
      <Knopf
        stil="linie"
        groesse="klein"
        disabled={laeuft}
        onClick={() =>
          starte(async () => {
            const antwort = await raeumeReservierungenAuf();
            setErgebnis(
              antwort.ok
                ? antwort.anzahl === 0
                  ? "Nichts abgelaufen"
                  : `${antwort.anzahl} freigegeben`
                : "Fehlgeschlagen",
            );
          })
        }
      >
        {laeuft ? "…" : "Abgelaufene freigeben"}
      </Knopf>
    </div>
  );
}
