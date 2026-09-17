"use client";

import { useEffect } from "react";
import { merkeCodeAusAdresse, merkeEinladungAusAdresse } from "@/lib/rabatt";

/**
 * Merkt sich einen Rabattcode aus der Adresse (?code=…), egal auf welcher
 * Seite der Link landet. Die Ticketauswahl reicht ihn später an die Kasse
 * weiter. Hängt im Layout, weil Links aus Instagram oder von Promotern
 * genauso gut auf die Startseite zeigen können wie auf ein Event.
 */
export function CodeMerker() {
  useEffect(() => {
    merkeCodeAusAdresse();
    merkeEinladungAusAdresse();
  }, []);
  return null;
}
