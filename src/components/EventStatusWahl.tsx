"use client";

import { useState, useTransition } from "react";
import { setzeEventStatus, erstatteEvent } from "@/app/aktionen/backoffice";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

const STATUS: Array<[string, string]> = [
  ["entwurf", "Entwurf"],
  ["veroeffentlicht", "Veröffentlicht"],
  ["abgesagt", "Abgesagt"],
  ["archiviert", "Archiviert"],
];

function marke(status: string) {
  if (status === "veroeffentlicht") return css.gut;
  if (status === "entwurf") return css.warte;
  if (status === "abgesagt") return css.schlecht;
  return css.neutral;
}

export function EventStatusWahl({
  id,
  status,
  titel,
}: {
  id: string;
  status: string;
  titel: string;
}) {
  const [laeuft, starte] = useTransition();
  const [erstattung, setErstattung] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  function erstatte() {
    // Geld an alle zurück ist unwiderruflich — hier die ausdrückliche Rückfrage.
    const sicher = confirm(
      `Für „${titel}" allen Gästen den Ticketpreis erstatten?\n\n` +
        `Karten- und PayPal-Zahlungen gehen automatisch zurück, Überweisungen ` +
        `und Barzahlungen werden zum manuellen Erstatten markiert. Alle bekommen ` +
        `eine Absage-Mail. Das lässt sich nicht rückgängig machen.`,
    );
    if (!sicher) return;
    setErstattung(true);
    setMeldung(null);
    starte(async () => {
      const e = await erstatteEvent(id);
      setErstattung(false);
      setMeldung(
        e.ok
          ? `${e.erstattet} automatisch erstattet, ${e.manuell} von Hand offen, ` +
            `${e.gemailt} benachrichtigt` +
            (e.fehlgeschlagen > 0 ? `, ${e.fehlgeschlagen} fehlgeschlagen` : "")
          : e.fehler,
      );
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
      <select
        value={status}
        disabled={laeuft}
        aria-label={`Status von ${titel}`}
        className={`${css.marke_} ${marke(status)}`}
        style={{ border: "1px solid currentColor", background: "transparent" }}
        onChange={(e) => {
          const neu = e.target.value;
          // Absagen ist für Gäste sichtbar und kaum zurückzunehmen —
          // dafür lohnt die Rückfrage.
          if (neu === "abgesagt") {
            const sicher = confirm(
              `„${titel}" wirklich absagen? Das Event bleibt für Ticketbesitzer sichtbar, ` +
                `aber es kann nichts mehr gekauft werden.`,
            );
            if (!sicher) {
              e.target.value = status;
              return;
            }
          }
          starte(async () => {
            await setzeEventStatus(id, neu);
          });
        }}
      >
        {STATUS.map(([wert, name]) => (
          <option key={wert} value={wert}>
            {name}
          </option>
        ))}
      </select>

      {status === "abgesagt" ? (
        <button
          type="button"
          onClick={erstatte}
          disabled={laeuft || erstattung}
          className={`${css.marke_} ${css.schlecht}`}
          style={{ border: "1px solid currentColor", background: "transparent", cursor: "pointer" }}
        >
          {erstattung ? "Erstatte…" : "Allen erstatten"}
        </button>
      ) : null}

      {meldung ? (
        <span style={{ fontSize: "12px", color: "var(--auf-grund-2)", maxWidth: "220px" }}>
          {meldung}
        </span>
      ) : null}
    </div>
  );
}
