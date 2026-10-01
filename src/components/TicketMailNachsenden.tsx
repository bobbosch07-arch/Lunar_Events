"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { sendeFehlendeTicketMails, sendeTicketMailNach } from "@/app/aktionen/ticketmail";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

/**
 * Ticket-Mail einer Bestellung nachschicken. Fehlt sie, ist es der
 * Hauptknopf der Zeile; ging sie schon raus, ein stiller Textknopf mit
 * Rückfrage — für Gäste, die sagen, sie hätten nichts bekommen.
 *
 * Scheitert der Versand, steht der Grund des Anbieters wörtlich da: Den
 * kennt sonst nur das Protokoll, und das vergisst Vercel nach einer Stunde.
 */
export function TicketMailNachsenden({
  bestellungId,
  email,
  gesendet,
}: {
  bestellungId: string;
  email: string;
  gesendet: boolean;
}) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<string | null>(null);

  const schicke = () =>
    starte(async () => {
      const antwort = await sendeTicketMailNach(bestellungId);
      setMeldung(antwort.ok ? "Verschickt" : antwort.grund);
      if (antwort.ok) router.refresh();
    });

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      {gesendet ? (
        <button
          type="button"
          className={css.textknopf}
          disabled={laeuft}
          onClick={() => {
            if (window.confirm(`Ticket-Mail noch einmal an ${email} schicken?`)) schicke();
          }}
        >
          {laeuft ? "…" : "Mail erneut"}
        </button>
      ) : (
        <>
          <span className={`${css.marke_} ${css.schlecht}`}>Mail fehlt</span>
          <Knopf stil="linie" groesse="klein" disabled={laeuft} onClick={schicke}>
            {laeuft ? "…" : "Nachsenden"}
          </Knopf>
        </>
      )}
      {meldung ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)", maxWidth: "32ch" }}>
          {meldung}
        </span>
      ) : null}
    </div>
  );
}

/** Über der Tabelle, solange bezahlte Bestellungen ohne Ticket-Mail da sind. */
export function FehlendeTicketMails({ anzahl }: { anzahl: number }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<string | null>(null);

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        marginBottom: "var(--space-4)",
        border: "1px solid rgba(166, 64, 64, 0.3)",
        borderRadius: "var(--radius-md)",
        background: "var(--error-weich)",
        color: "var(--error)",
        fontSize: "var(--fs-body-s)",
      }}
    >
      <span style={{ flex: "1 1 24ch" }}>
        {anzahl === 1
          ? "Eine bezahlte Bestellung hat keine Ticket-Mail bekommen."
          : `${anzahl} bezahlte Bestellungen haben keine Ticket-Mail bekommen.`}
        {meldung ? <><br />{meldung}</> : null}
      </span>
      <Knopf
        stil="primaer"
        groesse="klein"
        disabled={laeuft}
        onClick={() =>
          starte(async () => {
            const antwort = await sendeFehlendeTicketMails();
            if (antwort.ok) {
              setMeldung(
                antwort.offen > 0
                  ? `${antwort.verschickt} verschickt, ${antwort.offen} noch offen — noch einmal klicken.`
                  : `${antwort.verschickt} verschickt.`,
              );
            } else {
              setMeldung(
                `${antwort.verschickt > 0 ? `${antwort.verschickt} verschickt, dann: ` : ""}${antwort.grund}`,
              );
            }
            router.refresh();
          })
        }
      >
        {laeuft ? "…" : "Alle nachsenden"}
      </Knopf>
    </div>
  );
}
