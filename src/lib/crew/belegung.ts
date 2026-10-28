"use client";

import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { crewStand } from "@/lib/einlass";

export type Belegung = { drin: number; kapazitaet: number | null };

/**
 * „Gerade drin“ eines Events, live (0049): erster Stand per Abruf, danach
 * jede Änderung von einlass_stand über Supabase Realtime. Zur Sicherheit
 * jede Minute neu, falls die Verbindung unbemerkt eingeschlafen ist.
 */
export function useBelegung(eventId: string): Belegung | null {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const [stand, setStand] = useState<(Belegung & { eventId: string }) | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const client = (db.current ??= browserClient());
    let aktiv = true;
    const holen = async () => {
      const s = await crewStand(client, eventId);
      if (aktiv && s?.ergebnis === "ok") {
        setStand({ eventId, drin: s.drin ?? 0, kapazitaet: s.kapazitaet ?? null });
      }
    };
    void holen();
    const takt = setInterval(() => void holen(), 60_000);
    const kanal = client
      .channel(`belegung-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "einlass_stand", filter: `event_id=eq.${eventId}` },
        (nachricht) => {
          const drin = (nachricht.new as { drin?: number } | undefined)?.drin;
          if (aktiv && typeof drin === "number") {
            setStand((alt) => (alt && alt.eventId === eventId ? { ...alt, drin } : alt));
          }
        },
      )
      .subscribe();
    return () => {
      aktiv = false;
      clearInterval(takt);
      void client.removeChannel(kanal);
    };
  }, [eventId]);

  return stand && stand.eventId === eventId ? stand : null;
}

/** Ampel der Kassenkarte: mehr als 40 frei grün, 1–40 gelb, 0 rot. */
export function belegungsStufe(b: Belegung): { stufe: "gut" | "knapp" | "voll"; frei: number | null } {
  if (b.kapazitaet === null) return { stufe: "gut", frei: null };
  const frei = Math.max(0, b.kapazitaet - b.drin);
  return { stufe: frei === 0 ? "voll" : frei <= 40 ? "knapp" : "gut", frei };
}
