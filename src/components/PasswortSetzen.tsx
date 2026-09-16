"use client";

import { useState } from "react";
import { Knopf } from "./Knopf";
import { setzePasswort } from "@/app/aktionen/konto";
import { PASSWORT_MINDESTLAENGE, pruefePasswort } from "@/lib/passwort";
import css from "./Anmeldung.module.css";

export function PasswortSetzen({
  hatPasswort,
  email,
}: {
  hatPasswort: boolean;
  email?: string | null;
}) {
  const [erstes, setErstes] = useState("");
  const [zweites, setZweites] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (laeuft) return;
    setFehler(null);

    const grund = pruefePasswort(erstes, email);
    if (grund) return setFehler(grund);
    if (erstes !== zweites) return setFehler("Die beiden Eingaben sind nicht gleich.");

    setLaeuft(true);
    const antwort = await setzePasswort(erstes);
    setLaeuft(false);

    if (antwort.ok) {
      setFertig(true);
      setErstes("");
      setZweites("");
      return;
    }
    setFehler(
      antwort.fehler === "zu_schwach"
        ? (antwort.grund ?? "Das Passwort ist zu schwach.")
        : antwort.fehler === "zu_kurz"
        ? `Mindestens ${PASSWORT_MINDESTLAENGE} Zeichen.`
        : antwort.fehler === "kein_team"
          ? "Nur Team-Konten können ein Passwort setzen."
          : antwort.fehler === "zu_oft"
            ? "Zu viele Versuche. Warte ein paar Minuten."
            : "Das hat nicht geklappt. Versuch es bitte noch einmal.",
    );
  }

  const aendern = (setze: (w: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setze(e.target.value);
    setFehler(null);
    setFertig(false);
  };

  return (
    <form className={css.karte} onSubmit={absenden} noValidate>
      <h2 className={css.titel} style={{ fontSize: "1.5rem" }}>
        {hatPasswort || fertig ? "Passwort ändern" : "Passwort festlegen"}
      </h2>
      <p className={css.text}>
        Damit meldest du dich künftig direkt an, ohne auf eine Mail zu warten.
        Der Anmeldelink funktioniert trotzdem weiter — falls du es vergisst.
      </p>

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="passwort-neu">
          Neues Passwort
        </label>
        <input
          id="passwort-neu"
          type="password"
          autoComplete="new-password"
          className={`${css.eingabe} ${fehler ? css.fehlerhaft : ""}`}
          value={erstes}
          onChange={aendern(setErstes)}
        />
        <span className={css.hinweis}>
          Mindestens {PASSWORT_MINDESTLAENGE} Zeichen mit Groß- und
          Kleinbuchstaben, Zahl und Sonderzeichen. Am leichtesten zu merken ist
          ein kurzer Satz, z. B. „3 grüne Tassen Kaffee!“.
        </span>
      </div>

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="passwort-wiederholen">
          Wiederholen
        </label>
        <input
          id="passwort-wiederholen"
          type="password"
          autoComplete="new-password"
          className={`${css.eingabe} ${fehler ? css.fehlerhaft : ""}`}
          value={zweites}
          onChange={aendern(setZweites)}
        />
      </div>

      {fehler ? <p className={css.fehlertext}>{fehler}</p> : null}
      {fertig ? (
        <p className={css.text} role="status">
          <strong>Gespeichert.</strong> Ab jetzt geht die Anmeldung auch mit Passwort.
        </p>
      ) : null}

      <Knopf type="submit" disabled={laeuft}>
        {laeuft ? "…" : "Speichern"}
      </Knopf>
    </form>
  );
}
