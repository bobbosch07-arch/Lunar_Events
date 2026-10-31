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

  useEffect(() => {
    rueckruf.current = beiCode;
  }, [beiCode]);

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
          const kante = Math.min(v.videoWidth, v.videoHeight) * 0.7;
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
          <video ref={video} className="crew-video" playsInline muted />
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
