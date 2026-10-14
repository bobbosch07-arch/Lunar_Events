"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { frageNamenNach } from "@/app/aktionen/namen";

/**
 * Über der Bestellliste, solange Bestellungen kommender Events Tickets ohne
 * Namen haben und noch nicht angeschrieben wurden (0046). Ein Klick schickt
 * jeder davon einmal die Bitte, die Namen auf der Ticketseite einzutragen.
 */
export function NamenNachfragen({ anzahl }: { anzahl: number }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<string | null>(null);

  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        marginBottom: "var(--space-4)",
        border: "1px solid var(--border-gold)",
        borderRadius: "var(--radius-md)",
        fontSize: "var(--fs-body-s)",
      }}
    >
      <span style={{ flex: "1 1 24ch" }}>
        {anzahl === 1
          ? "Bei einer Bestellung fehlen Namen auf Tickets."
          : `Bei ${anzahl} Bestellungen fehlen Namen auf Tickets.`}{" "}
        Am Einlass werden Ausweise kontrolliert; die Mail bittet, die Namen auf der Ticketseite
        einzutragen. Jede Bestellung bekommt sie nur einmal.
        {meldung ? <><br />{meldung}</> : null}
      </span>
      <Knopf
        stil="primaer"
        groesse="klein"
        disabled={laeuft}
        onClick={() => {
          if (
            !window.confirm(
              anzahl === 1
                ? "Eine Mail mit der Bitte um die Namen verschicken?"
                : `${anzahl} Mails mit der Bitte um die Namen verschicken?`,
            )
          ) {
            return;
          }
          starte(async () => {
            const antwort = await frageNamenNach();
            if (antwort.ok) {
              setMeldung(
                antwort.offen > 0
                  ? `${antwort.verschickt} verschickt, ${antwort.offen} noch offen. Noch einmal klicken.`
                  : `${antwort.verschickt} verschickt.`,
              );
            } else {
              setMeldung(
                `${antwort.verschickt > 0 ? `${antwort.verschickt} verschickt, dann: ` : ""}${antwort.grund}`,
              );
            }
            router.refresh();
          });
        }}
      >
        {laeuft ? "…" : "Namen anfragen"}
      </Knopf>
    </div>
  );
}
