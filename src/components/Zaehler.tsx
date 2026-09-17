"use client";

import { useEffect, useRef } from "react";

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
 */
export function zaehle(art: EreignisArt, eventId?: string | null) {
  if (typeof window === "undefined") return;

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
}: {
  art: EreignisArt;
  eventId?: string | null;
}) {
  const gezaehlt = useRef(false);

  useEffect(() => {
    if (gezaehlt.current) return;
    gezaehlt.current = true;
    zaehle(art, eventId);
  }, [art, eventId]);

  return null;
}
