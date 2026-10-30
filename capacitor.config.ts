import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Lunar Crew als Android-App (Phase 2 der Crew-App, 30.10.2026).
 *
 * Wie Love OS lädt die App die Oberfläche von der Website (`server.url`):
 * Jede Änderung an /crew ist nach dem Deploy in der App, ohne neue APK. Neu
 * bauen muss man nur bei nativen Änderungen (Scanner, Rechte, Symbol).
 *
 * Ohne Netz startet sie trotzdem: Die Android-WebView kennt Service Worker,
 * und /crew bringt seinen eigenen mit (public/crew-sw.js) — dieselbe
 * Offline-Fähigkeit wie die Home-Bildschirm-App auf dem iPhone.
 *
 * Der Scanner ist nativ (@capacitor-mlkit/barcode-scanning, ML Kit), siehe
 * src/components/crew/CrewKamera.tsx. Im Browser bleibt es bei jsQR.
 */
const config: CapacitorConfig = {
  appId: "de.lunarevents.crew",
  appName: "Lunar Crew",
  // Muss es geben, wird bei server.url aber nicht ausgeliefert.
  webDir: "capacitor-leer",
  server: {
    url: "https://lunar-events.de/crew",
    cleartext: false,
  },
  android: {
    backgroundColor: "#220a4f",
  },
};

export default config;
