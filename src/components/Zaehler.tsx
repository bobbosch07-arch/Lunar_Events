"use client";

import { useEffect, useRef } from "react";
import { messe, type MessDaten } from "@/lib/messen";

export type EreignisArt =
  | "seite"
  | "event_gesehen"
  | "ticket_gewaehlt"
  | "kasse_begonnen"
  | "daten_erfasst"
  | "kauf_abgeschlossen"
  | "vip_angefragt";

/**
 * Meldet ein Ereignis. Läuft über sendBeacon, damit ein Seitenwechsel
 * die Meldung nicht abschneidet — und damit sie nichts verzögert.
 *
 * Seit 03.10.2026 geht es zusätzlich an GA4 und Meta, aber nur, wenn im
 * Banner zugestimmt wurde (`messe`). Die eigene Zählung hängt daran nicht:
 * Sie läuft ohne Cookie für alle weiter.
 */
export function zaehle(art: EreignisArt, eventId?: string | null, daten?: MessDaten) {
  if (typeof window === "undefined") return;
  messe(art, eventId, daten);

  const suche = new URLSearchParams(window.location.search);
  const kampagne = suche.get("utm_campaign");
  const koerper = JSON.stringify({
    art,
    eventId: eventId ?? null,
    kampagne,
    // Kam der Aufruf über den Link eines Promoters? Daraus werden seine
    // Klicks. Gelesen aus der Adresse, nicht aus einem Speicher.
    promo: suche.get("promo"),
    mobil: window.matchMedia("(max-width: 768px)").matches,
  });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/ereignis",
        new Blob([koerper], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/ereignis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: koerper,
      keepalive: true,
    });
  } catch {
    // Zählen ist Beiwerk. Scheitert es, passiert nichts weiter.
  }
}

/**
 * Zählt einmal beim Anzeigen. Der Verweis verhindert, dass React im
 * Entwicklungsmodus (doppeltes Ausführen von Effekten) zweimal zählt.
 */
export function Zaehler({
  art,
  eventId,
  daten,
}: {
  art: EreignisArt;
  eventId?: string | null;
  daten?: MessDaten;
}) {
  const gezaehlt = useRef(false);

  useEffect(() => {
    if (gezaehlt.current) return;
    gezaehlt.current = true;
    zaehle(art, eventId, daten);
    // daten ist ein Objekt aus der Seite und ändert sich nicht; gezählt
    // wird ohnehin nur einmal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art, eventId]);

  return null;
}
