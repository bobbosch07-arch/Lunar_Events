"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { bestaetigeVorkasse } from "@/app/aktionen/vorkasse";

/**
 * "Zahlung eingegangen" für eine Vorkasse-Bestellung.
 *
 * Mit Rückfrage: Der Klick stellt Tickets aus, die sich nicht still
 * zurücknehmen lassen. Vorher soll jemand Betrag und Verwendungszweck
 * auf dem Kontoauszug abgeglichen haben.
 */
export function VorkasseEingang({
  bestellungId,
  nummer,
  betrag,
}: {
  bestellungId: string;
  nummer: string;
  betrag: string;
}) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <button
        type="button"
        disabled={laeuft}
        style={{
          padding: "6px 12px",
          border: "1px solid var(--navy-900)",
          borderRadius: "var(--radius-md)",
          background: "var(--navy-900)",
          color: "var(--ivory-50)",
          fontSize: "var(--fs-caption)",
          cursor: laeuft ? "wait" : "pointer",
        }}
        onClick={() => {
          const ok = window.confirm(
            `${betrag} mit Verwendungszweck ${nummer} ist auf dem Konto eingegangen?\n\nDanach werden die Tickets ausgestellt.`,
          );
          if (!ok) return;
          starte(async () => {
            const antwort = await bestaetigeVorkasse(bestellungId);
            if (antwort.ok) {
              setMeldung("Tickets ausgestellt");
              router.refresh();
              return;
            }
            setMeldung(
              antwort.fehler === "abgelaufen"
                ? "Frist abgelaufen — Plätze sind wieder frei. Geld zurücküberweisen."
                : antwort.fehler === "schon_bezahlt"
                  ? "War schon bestätigt"
                  : antwort.fehler === "kein_team"
                    ? "Keine Berechtigung"
                    : "Fehlgeschlagen",
            );
          });
        }}
      >
        {laeuft ? "…" : "Zahlung eingegangen"}
      </button>
      {meldung ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)" }}>
          {meldung}
        </span>
      ) : null}
    </div>
  );
}
