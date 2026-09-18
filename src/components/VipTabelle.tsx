"use client";

import { Fragment, useState, useTransition } from "react";
import { Link } from "@/i18n/navigation";
import { setzeVipStatus } from "@/app/aktionen/backoffice";
import { preisText } from "@/lib/format";
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
}: {
  // Fertig formatiert vom Server. Eine Funktion laesst sich nicht an
  // eine Client-Komponente reichen — React bricht die Seite dann mit
  // "Functions cannot be passed directly to Client Components" ab.
  anfragen: Array<VipZeile & { erstelltAmText: string }>;
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
            <th>Tickets</th>
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
                <td className={css.nebensache}>{a.erstelltAmText}</td>
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
                <td onClick={(e) => e.stopPropagation()}>
                  {/* Nach der Zusage: benannte Tickets je Gast (0028). */}
                  <Link href={`/backoffice/vip/${a.id}`} className={css.textknopf}>
                    {a.tickets > 0
                      ? `${a.tickets} ${a.tickets === 1 ? "Ticket" : "Tickets"}${a.tisch ? ` · ${a.tisch}` : ""}`
                      : a.status === "abgelehnt"
                        ? "Ansehen"
                        : "Ausstellen"}
                  </Link>
                  {a.betragCent !== null ? (
                    <div className={css.nebensache}>
                      {preisText(a.betragCent)} · {a.bezahlt ? "bezahlt" : "offen"}
                    </div>
                  ) : null}
                </td>
              </tr>
              {offen === a.id && a.nachricht ? (
                <tr>
                  <td colSpan={8} style={{ whiteSpace: "normal", background: "var(--ivory-100)" }}>
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
