"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { browserClient } from "@/lib/supabase/client";
import { bildUrl } from "@/lib/bilder";
import css from "./BildFeld.module.css";

type Props = {
  /** Pfad im Ablageort, nicht die vollständige Adresse. */
  pfad: string;
  alt: string;
  fokus: string;
  aendern: (werte: { pfad: string; alt: string; fokus: string }) => void;
};

const FOKUS: Array<[string, string]> = [
  ["center", "Mitte"],
  ["top", "Oben"],
  ["bottom", "Unten"],
  ["left", "Links"],
  ["right", "Rechts"],
  ["top left", "Oben links"],
  ["top right", "Oben rechts"],
];

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Der Upload läuft direkt vom Browser in den Ablageort, nicht über
 * unseren Server: ein 8-MB-Bild durch eine Serverless-Funktion zu
 * schleusen kostet Zeit und stößt an Größengrenzen.
 */
export function BildFeld({ pfad, alt, fokus, aendern }: Props) {
  const feld = useRef<HTMLInputElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function hochladen(datei: File) {
    setFehler(null);

    if (datei.size > MAX_BYTES) {
      setFehler(
        `Das Bild ist ${(datei.size / 1024 / 1024).toFixed(1)} MB groß. Mehr als 10 MB nimmt der Ablageort nicht — vorher verkleinern.`,
      );
      return;
    }

    setLaeuft(true);
    const db = browserClient();

    const endung = datei.name.split(".").pop()?.toLowerCase() ?? "jpg";
    // Zufälliger Name: zwei Bilder mit demselben Dateinamen würden sich
    // sonst gegenseitig überschreiben.
    const ziel = `${crypto.randomUUID()}.${endung}`;

    const { error } = await db.storage.from("events").upload(ziel, datei, {
      cacheControl: "31536000",
      upsert: false,
    });

    setLaeuft(false);

    if (error) {
      setFehler(
        error.message.includes("row-level security")
          ? "Keine Berechtigung zum Hochladen. Ist dieses Konto im Team?"
          : error.message,
      );
      return;
    }

    aendern({ pfad: ziel, alt, fokus });
  }

  return (
    <div className={css.feld}>
      <div className={css.vorschau}>
        {pfad ? (
          <Image
            src={bildUrl(pfad)}
            alt={alt || "Vorschau"}
            fill
            sizes="320px"
            className={css.bild}
            style={{ objectPosition: fokus || "center" }}
            unoptimized
          />
        ) : (
          <span className={css.leer}>Kein Bild</span>
        )}
      </div>

      <div className={css.steuerung}>
        <input
          ref={feld}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className={css.dateifeld}
          onChange={(e) => {
            const datei = e.target.files?.[0];
            if (datei) void hochladen(datei);
          }}
        />

        <button
          type="button"
          className={css.knopf}
          disabled={laeuft}
          onClick={() => feld.current?.click()}
        >
          {laeuft ? "Lädt hoch …" : pfad ? "Bild austauschen" : "Bild wählen"}
        </button>

        {pfad ? (
          <button
            type="button"
            className={css.entfernen}
            onClick={() => aendern({ pfad: "", alt, fokus })}
          >
            Entfernen
          </button>
        ) : null}

        <label className={css.zeile}>
          <span className={css.beschriftung}>Bildbeschreibung</span>
          <input
            className={css.eingabe}
            value={alt}
            placeholder="Was ist zu sehen?"
            onChange={(e) => aendern({ pfad, alt: e.target.value, fokus })}
          />
          <span className={css.hinweis}>
            Für Screenreader und für den Fall, dass das Bild nicht lädt.
          </span>
        </label>

        <label className={css.zeile}>
          <span className={css.beschriftung}>Bildausschnitt</span>
          <select
            className={css.eingabe}
            value={fokus || "center"}
            onChange={(e) => aendern({ pfad, alt, fokus: e.target.value })}
          >
            {FOKUS.map(([wert, name]) => (
              <option key={wert} value={wert}>
                {name}
              </option>
            ))}
          </select>
          <span className={css.hinweis}>
            Karten sind 4:3, der Hero ist breit — hier bestimmst du, welcher
            Teil erhalten bleibt.
          </span>
        </label>

        {fehler ? <p className={css.fehler}>{fehler}</p> : null}
      </div>
    </div>
  );
}
