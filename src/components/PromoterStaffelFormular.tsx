"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { speichereStaffel } from "@/app/aktionen/promoter";
import css from "./EventFormular.module.css";

type Zeile = { ab: string; belohnung: string };

/**
 * Stichtag und Stufen der Promoter-Staffel eines Events (0040). Stufen
 * stapeln sich: Wer 15 hat, bekommt auch, was es bei 5 und 10 gibt. Das
 * steht so auch auf der Seite der Promoter.
 */
export function PromoterStaffelFormular({
  eventId,
  stichtag: startStichtag,
  stufen: startStufen,
}: {
  eventId: string;
  /** Ortszeit Berlin für das Feld, "" ohne Stichtag. */
  stichtag: string;
  stufen: Array<{ ab: number; belohnung: string }>;
}) {
  const router = useRouter();
  const [stichtag, setStichtag] = useState(startStichtag);
  const [zeilen, setZeilen] = useState<Zeile[]>(
    startStufen.length > 0
      ? startStufen.map((s) => ({ ab: String(s.ab), belohnung: s.belohnung }))
      : [{ ab: "", belohnung: "" }],
  );
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [laeuft, starte] = useTransition();

  const setze = (i: number, feld: keyof Zeile, wert: string) =>
    setZeilen((alt) => alt.map((z, j) => (j === i ? { ...z, [feld]: wert } : z)));

  return (
    <section className={css.gruppe} style={{ maxWidth: 940, marginTop: "2rem" }}>
      <h2 className={css.gruppenTitel}>Promoter-Staffel</h2>
      <span className={css.hinweis}>
        Ab so vielen bezahlten Tickets gibt es diese Belohnung. Jede Stufe enthält
        alle vorherigen. Jeder Promoter sieht auf seiner Seite nur seinen eigenen
        Stand; die Rangliste unten sieht nur ihr.
      </span>

      <div className={css.feld} style={{ maxWidth: 280 }}>
        <label className={css.beschriftung} htmlFor="staffel-stichtag">
          Stichtag
        </label>
        <input
          id="staffel-stichtag"
          type="datetime-local"
          className={css.eingabe}
          value={stichtag}
          onChange={(e) => setStichtag(e.target.value)}
        />
        <span className={css.hinweis}>
          Bis dahin bezahlte Tickets zählen für Staffel und Rangliste. Leer: alles
          bis zum Event.
        </span>
      </div>

      {zeilen.map((z, i) => (
        <div key={i} className={css.raster} style={{ gridTemplateColumns: "120px 1fr auto", alignItems: "end" }}>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor={`stufe-ab-${i}`}>
              Ab Tickets
            </label>
            <input
              id={`stufe-ab-${i}`}
              className={css.eingabe}
              inputMode="numeric"
              placeholder="5"
              value={z.ab}
              onChange={(e) => setze(i, "ab", e.target.value)}
            />
          </div>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor={`stufe-text-${i}`}>
              Belohnung
            </label>
            <input
              id={`stufe-text-${i}`}
              className={css.eingabe}
              maxLength={200}
              placeholder="1 Gratis-Ticket"
              value={z.belohnung}
              onChange={(e) => setze(i, "belohnung", e.target.value)}
            />
          </div>
          <button
            type="button"
            className={css.entfernen}
            aria-label={`Stufe ${z.ab || i + 1} entfernen`}
            onClick={() => setZeilen((alt) => alt.filter((_, j) => j !== i))}
          >
            Entfernen
          </button>
        </div>
      ))}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Knopf
          stil="linie"
          groesse="klein"
          onClick={() => setZeilen((alt) => [...alt, { ab: "", belohnung: "" }])}
        >
          Stufe hinzufügen
        </Knopf>
        <Knopf
          groesse="klein"
          disabled={laeuft}
          onClick={() =>
            starte(async () => {
              setMeldung(null);
              const antwort = await speichereStaffel({
                eventId,
                stichtag,
                stufen: zeilen
                  .filter((z) => z.ab.trim() !== "" || z.belohnung.trim() !== "")
                  .map((z) => ({ ab: Number(z.ab.trim()), belohnung: z.belohnung })),
              });
              setMeldung(
                antwort.ok
                  ? { text: "Gespeichert.", fehler: false }
                  : { text: antwort.fehler, fehler: true },
              );
              if (antwort.ok) router.refresh();
            })
          }
        >
          {laeuft ? "…" : "Staffel speichern"}
        </Knopf>
      </div>
      {meldung ? (
        <p className={meldung.fehler ? css.stoerung : css.hinweis} role="status">
          {meldung.text}
        </p>
      ) : null}
    </section>
  );
}
