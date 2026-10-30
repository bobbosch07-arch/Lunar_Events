"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import jsQR from "jsqr";

/**
 * Das Kamerafeld der Crew-App: Video, Zielrahmen, „Kamera starten“. Scanner
 * und Garderobe benutzen dasselbe Feld, damit es nur eine Stelle gibt, an der
 * die Kamera läuft. Jeder gefundene Code geht an `beiCode` — wer ihn gerade
 * nicht will (Tab verdeckt, Marke wartet auf ihre Nummer), entscheidet dort.
 *
 * Gestartet wird erst auf Tippen: iOS gibt die Kamera nur nach einer Geste
 * frei, und so fragt die App nicht schon beim Öffnen nach.
 *
 * `children` liegt über dem Bild (Ergebnis der Garderobe), ohne die Kamera
 * anzuhalten — der nächste Gast kann schon scannen.
 */
export function CrewKamera({ beiCode, children }: { beiCode: (code: string) => void; children?: ReactNode }) {
  const video = useRef<HTMLVideoElement>(null);
  const leinwand = useRef<HTMLCanvasElement>(null);
  const strom = useRef<MediaStream | null>(null);
  const laufend = useRef(false);
  const rueckruf = useRef(beiCode);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(false);

  useEffect(() => {
    rueckruf.current = beiCode;
  }, [beiCode]);

  async function starten() {
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

  useEffect(() => {
    return () => {
      laufend.current = false;
      strom.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="crew-kamera" role="img" aria-label="Kamerabild">
      <video ref={video} className="crew-video" playsInline muted />
      <canvas ref={leinwand} hidden />
      {laeuft ? (
        <div className="crew-zielrahmen" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : (
        <button type="button" className="btn btn-primary crew-kamera-start" onClick={() => void starten()}>
          <i className="ph-bold ph-qr-code" aria-hidden="true" />
          {fehler ? "Kamera erneut versuchen" : "Kamera starten"}
        </button>
      )}
      {children}
    </div>
  );
}
