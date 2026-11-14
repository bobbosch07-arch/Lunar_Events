"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import jsQR from "jsqr";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

/**
 * Das Kamerafeld der Crew-App: Video, Zielrahmen, „Kamera starten“. Scanner
 * und Garderobe benutzen dasselbe Feld, damit es nur eine Stelle gibt, an der
 * die Kamera läuft. Jeder gefundene Code geht an `beiCode` — wer ihn gerade
 * nicht will (Tab verdeckt, Marke wartet auf ihre Nummer), entscheidet dort.
 *
 * Zwei Wege, dieselbe Oberfläche:
 * - **Browser** (iPhone vom Home-Bildschirm): getUserMedia + jsQR.
 * - **Android-App** (Capacitor, Phase 2): ML Kit über
 *   @capacitor-mlkit/barcode-scanning — schneller, liest auch zerkratzte und
 *   schräge Codes, mit Taschenlampe. Das Plugin legt das Kamerabild *hinter*
 *   die WebView; dieses Feld wird dafür durchsichtig (`data-nativ`, Regeln in
 *   crew.css unter „Nativer Scanner“). Deshalb läuft der native Scan nur,
 *   solange das Feld sichtbar ist — sonst schiene die Kamera durch andere Tabs.
 *
 * Gestartet wird erst auf Tippen: Kamerarechte werden nur nach einer Geste
 * erfragt, und so fragt die App nicht schon beim Öffnen nach.
 *
 * `children` liegt über dem Bild (Ergebnis der Garderobe), ohne die Kamera
 * anzuhalten — der nächste Gast kann schon scannen.
 */
const ZOOM_SCHLUESSEL = "lunar.crew.zoom";

export function CrewKamera({ beiCode, children }: { beiCode: (code: string) => void; children?: ReactNode }) {
  const feld = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const strom = useRef<MediaStream | null>(null);
  const laufend = useRef(false);
  const rueckruf = useRef(beiCode);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(false);
  const [nativ, setNativ] = useState(false);
  const [licht, setLicht] = useState<boolean | null>(null);
  // Zoom 1× / 2× (14.11.): für kleine oder weiter entfernte Codes. Echt, wo
  // die Kamera es kann (`hardware`), sonst digital: Bild größer zeigen und nur
  // die Mitte durchsuchen. Die Wahl merkt sich das Gerät.
  const [zoom, setZoom] = useState<1 | 2>(1);
  const zoomRef = useRef<1 | 2>(1);
  const [hardware, setHardware] = useState(false);
  const hardwareRef = useRef(false);
  useEffect(() => {
    hardwareRef.current = hardware;
  }, [hardware]);

  useEffect(() => {
    rueckruf.current = beiCode;
  }, [beiCode]);

  /** Gemerkten Zoom beim Start der Kamera übernehmen. */
  function gemerkterZoom() {
    try {
      if (localStorage.getItem(ZOOM_SCHLUESSEL) === "2") {
        zoomRef.current = 2;
        setZoom(2);
      }
    } catch {
      // Ohne Speicher eben 1×.
    }
  }

  // Zoom anwenden: nativ über ML Kit, im Browser über die Kamera selbst,
  // sonst bleibt es beim digitalen Weg (Darstellung + Suchfeld).
  useEffect(() => {
    zoomRef.current = zoom;
    if (!laeuft) return;
    if (nativ) {
      void import("@capacitor-mlkit/barcode-scanning").then(async ({ BarcodeScanner }) => {
        try {
          const [{ zoomRatio: min }, { zoomRatio: max }] = await Promise.all([
            BarcodeScanner.getMinZoomRatio(),
            BarcodeScanner.getMaxZoomRatio(),
          ]);
          await BarcodeScanner.setZoomRatio({ zoomRatio: Math.min(max, Math.max(min, zoom)) });
        } catch {
          // Scanner gerade nicht aktiv (Tab verdeckt): beim nächsten Wechsel.
        }
      });
      return;
    }
    const spur = strom.current?.getVideoTracks()[0];
    const faehig = spur?.getCapabilities?.() as (MediaTrackCapabilities & { zoom?: { min: number; max: number } }) | undefined;
    if (spur && faehig?.zoom) {
      const wert = Math.min(faehig.zoom.max, Math.max(faehig.zoom.min, zoom));
      void spur
        .applyConstraints({ advanced: [{ zoom: wert } as MediaTrackConstraintSet] })
        .then(() => setHardware(true))
        .catch(() => setHardware(false));
    }
  }, [zoom, laeuft, nativ]);

  function zoomUmschalten() {
    const neu = zoom === 1 ? 2 : 1;
    setZoom(neu);
    try {
      localStorage.setItem(ZOOM_SCHLUESSEL, String(neu));
    } catch {
      // Ohne Speicher gilt es bis zum Neustart.
    }
  }

  async function startenNativ() {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== "granted" && camera !== "limited") {
      setFehler(true);
      return;
    }
    setFehler(false);
    setNativ(true);
    setLaeuft(true);
  }

  async function startenBrowser() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      strom.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setFehler(false);
      setLaeuft(true);
      laufend.current = true;
      const schritt = () => {
        const v = video.current;
        const c = leinwand.current;
        if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
          // Digitaler Zoom: nur die Mitte durchsuchen (bei echtem Zoom nicht nötig).
          const teil = hardwareRef.current ? 1 : zoomRef.current;
          const kante = (Math.min(v.videoWidth, v.videoHeight) * 0.7) / teil;
          c.width = kante;
          c.height = kante;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(v, (v.videoWidth - kante) / 2, (v.videoHeight - kante) / 2, kante, kante, 0, 0, kante, kante);
            const bild = ctx.getImageData(0, 0, kante, kante);
            const treffer = jsQR(bild.data, bild.width, bild.height, { inversionAttempts: "dontInvert" });
            if (treffer?.data) rueckruf.current(treffer.data);
          }
        }
        if (laufend.current) requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    } catch {
      setFehler(true);
    }
  }

  function starten() {
    gemerkterZoom();
    if (Capacitor.isNativePlatform()) void startenNativ().catch(() => setFehler(true));
    else void startenBrowser();
  }

  // Nativ: scannen, solange das Feld zu sehen ist und die App vorne liegt.
  useEffect(() => {
    if (!nativ) return;
    const el = feld.current;
    if (!el) return;
    let aus = false;
    let an = false;
    let hoerer: PluginListenerHandle | null = null;
    let kette = Promise.resolve();
    const plugin = import("@capacitor-mlkit/barcode-scanning");

    const abgleichen = () => {
      // Nacheinander, damit Start und Stopp sich nicht überholen.
      kette = kette.then(async () => {
        const { BarcodeScanner, BarcodeFormat } = await plugin;
        const sichtbar = !aus && el.offsetWidth > 0 && el.offsetHeight > 0 && document.visibilityState === "visible";
        if (sichtbar && !an) {
          hoerer ??= await BarcodeScanner.addListener("barcodesScanned", (e) => {
            for (const b of e.barcodes) if (b.rawValue) rueckruf.current(b.rawValue);
          });
          document.documentElement.classList.add("crew-nativ-kamera");
          await BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] });
          an = true;
          // Zoom erst jetzt möglich — vorher läuft keine Kamera.
          if (zoomRef.current !== 1) {
            await Promise.all([BarcodeScanner.getMinZoomRatio(), BarcodeScanner.getMaxZoomRatio()])
              .then(([{ zoomRatio: min }, { zoomRatio: max }]) =>
                BarcodeScanner.setZoomRatio({ zoomRatio: Math.min(max, Math.max(min, zoomRef.current)) }),
              )
              .catch(() => {});
          }
          const { available } = await BarcodeScanner.isTorchAvailable().catch(() => ({ available: false }));
          if (!aus) setLicht(available ? false : null);
        } else if (!sichtbar && an) {
          an = false;
          await BarcodeScanner.stopScan().catch(() => {});
          document.documentElement.classList.remove("crew-nativ-kamera");
          if (!aus) setLicht((l) => (l === null ? null : false));
        }
      }).catch(() => {
        if (!aus) setFehler(true);
      });
    };

    const beobachter = new ResizeObserver(abgleichen);
    beobachter.observe(el);
    document.addEventListener("visibilitychange", abgleichen);
    abgleichen();
    return () => {
      aus = true;
      beobachter.disconnect();
      document.removeEventListener("visibilitychange", abgleichen);
      kette = kette.then(async () => {
        const { BarcodeScanner } = await plugin;
        await hoerer?.remove();
        if (an) await BarcodeScanner.stopScan().catch(() => {});
        document.documentElement.classList.remove("crew-nativ-kamera");
      });
    };
  }, [nativ]);

  async function lichtUmschalten() {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    await BarcodeScanner.toggleTorch().catch(() => {});
    const { enabled } = await BarcodeScanner.isTorchEnabled().catch(() => ({ enabled: false }));
    setLicht(enabled);
  }

  // Browser (iPhone vom Home-Bildschirm): Bildschirm anlassen, solange die
  // Kamera läuft — an der Tür geht er sonst zwischen zwei Gästen aus. Das
  // System gibt die Sperre beim Wegwischen der App frei, deshalb bei jeder
  // Rückkehr neu anfordern. Die Android-App macht das nativ (MainActivity).
  useEffect(() => {
    if (!laeuft || nativ || !("wakeLock" in navigator)) return;
    let sperre: WakeLockSentinel | null = null;
    let aus = false;
    const anfordern = async () => {
      if (aus || document.visibilityState !== "visible") return;
      try {
        sperre = await navigator.wakeLock.request("screen");
        if (aus) void sperre.release();
      } catch {
        // Nicht erlaubt (Stromsparmodus): dann eben ohne.
      }
    };
    void anfordern();
    document.addEventListener("visibilitychange", anfordern);
    return () => {
      aus = true;
      document.removeEventListener("visibilitychange", anfordern);
      void sperre?.release().catch(() => {});
    };
  }, [laeuft, nativ]);

  // Browser: Kamera beim Verlassen freigeben.
  useEffect(() => {
    return () => {
      laufend.current = false;
      strom.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div ref={feld} className="crew-kamera" role="img" aria-label="Kamerabild" data-nativ={nativ || undefined}>
      {nativ ? null : (
        <>
          <video
            ref={video}
            className="crew-video"
            playsInline
            muted
            style={zoom === 2 && !hardware ? { transform: "scale(2)" } : undefined}
          />
          <canvas ref={leinwand} hidden />
        </>
      )}
      {laeuft ? (
        <div className="crew-zielrahmen" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : (
        <button type="button" className="btn btn-primary crew-kamera-start" onClick={starten}>
          <i className="ph-bold ph-qr-code" aria-hidden="true" />
          {fehler ? "Kamera erneut versuchen" : "Kamera starten"}
        </button>
      )}
      {laeuft ? (
        <button
          type="button"
          className="btn btn-secondary crew-zoom"
          aria-pressed={zoom === 2}
          aria-label={zoom === 2 ? "Zoom aus" : "Zoom an"}
          onClick={zoomUmschalten}
        >
          {zoom}×
        </button>
      ) : null}
      {licht !== null ? (
        <button
          type="button"
          className="btn btn-secondary crew-licht"
          aria-pressed={licht}
          aria-label={licht ? "Taschenlampe aus" : "Taschenlampe an"}
          onClick={() => void lichtUmschalten()}
        >
          <i className={`${licht ? "ph-fill" : "ph-bold"} ph-flashlight`} aria-hidden="true" />
        </button>
      ) : null}
      {children}
    </div>
  );
}
