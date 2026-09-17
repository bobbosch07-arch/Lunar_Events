"use client";

import { useState } from "react";
import { Knopf } from "./Knopf";

/**
 * Ein Link zum Kopieren. Der Text bleibt markierbar stehen — falls der
 * Browser den Zugriff auf die Zwischenablage verweigert, geht es von Hand.
 */
export function KopierFeld({
  wert,
  beschriftung,
  kopiert,
  klasse,
  wertKlasse,
  stil = "linie",
}: {
  wert: string;
  beschriftung: string;
  kopiert: string;
  klasse?: string;
  wertKlasse?: string;
  stil?: "linie" | "linieHell";
}) {
  const [erledigt, setErledigt] = useState(false);

  return (
    <div className={klasse}>
      <code className={wertKlasse}>{wert}</code>
      <Knopf
        stil={stil}
        groesse="klein"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(wert);
            setErledigt(true);
            setTimeout(() => setErledigt(false), 2000);
          } catch {
            // Dann eben markieren und kopieren.
          }
        }}
      >
        <span aria-live="polite">{erledigt ? kopiert : beschriftung}</span>
      </Knopf>
    </div>
  );
}
