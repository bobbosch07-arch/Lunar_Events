"use client";

import { Fragment, useState, useTransition } from "react";
import { setzeVipStatus } from "@/app/aktionen/backoffice";
import type { VipZeile } from "@/lib/backoffice";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

const STATUS: Array<[string, string]> = [
  ["neu", "Neu"],
  ["in_bearbeitung", "In Arbeit"],
  ["angebot", "Angebot raus"],
  ["bestaetigt", "Bestätigt"],
  ["abgelehnt", "Abgelehnt"],
];

function marke(status: string) {
  if (status === "neu") return css.warte;
  if (status === "bestaetigt") return css.gut;
  if (status === "abgelehnt") return css.schlecht;
  return css.neutral;
}

export function VipTabelle({
  anfragen,
  formatiere,
}: {
  anfragen: VipZeile[];
  formatiere: (iso: string) => string;
}) {
  const [laeuft, starte] = useTransition();
  const [offen, setOffen] = useState<string | null>(null);

  if (anfragen.length === 0) {
    return (
      <div className={css.tabellenfeld}>
        <p className={css.leer}>Noch keine VIP-Anfragen.</p>
      </div>
    );
  }

  return (
    <div className={css.tabellenfeld}>
      <table className={css.tabelle}>
        <thead>
          <tr>
            <th>Wer</th>
            <th>Kontakt</th>
            <th>Event</th>
            <th className={css.zahl}>Gäste</th>
            <th>Paket</th>
            <th>Eingegangen</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {anfragen.map((a) => (
            <Fragment key={a.id}>
              <tr
                onClick={() => setOffen(offen === a.id ? null : a.id)}
                style={{ cursor: a.nachricht ? "pointer" : "default" }}
              >
                <td className={css.haupt}>
                  {a.name}
                  {a.nachricht ? (
                    <span className={css.nebensache}> · Nachricht</span>
                  ) : null}
                </td>
                <td>
                  <a href={`mailto:${a.email}`}>{a.email}</a>
                  {a.telefon ? (
                    <div className={css.nebensache}>
                      <a href={`tel:${a.telefon}`}>{a.telefon}</a>
                    </div>
                  ) : null}
                </td>
                <td className={css.nebensache}>
                  {a.event ?? (a.wunschdatum ? `Wunsch: ${a.wunschdatum}` : "—")}
                </td>
                <td className={css.zahl}>{a.gaeste}</td>
                <td className={css.nebensache}>{a.paket ?? "offen"}</td>
                <td className={css.nebensache}>{formatiere(a.erstelltAm)}</td>
                <td>
                  <select
                    value={a.status}
                    disabled={laeuft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      starte(async () => {
                        await setzeVipStatus(a.id, e.target.value);
                      })
                    }
                    className={`${css.marke_} ${marke(a.status)}`}
                    style={{ border: "1px solid currentColor", background: "transparent" }}
                    aria-label={`Status von ${a.name}`}
                  >
                    {STATUS.map(([wert, name]) => (
                      <option key={wert} value={wert}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              {offen === a.id && a.nachricht ? (
                <tr>
                  <td colSpan={7} style={{ whiteSpace: "normal", background: "var(--ivory-100)" }}>
                    {a.nachricht}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
