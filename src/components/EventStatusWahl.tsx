"use client";

import { useTransition } from "react";
import { setzeEventStatus } from "@/app/aktionen/backoffice";
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

  return (
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
  );
}
