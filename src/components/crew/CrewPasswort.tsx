"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { setzeCrewPasswort } from "@/app/aktionen/crew";
import { PASSWORT_MINDESTLAENGE, pruefePasswort } from "@/lib/passwort";

export function CrewPasswort({ email }: { email: string | null }) {
  const [erstes, setErstes] = useState("");
  const [zweites, setZweites] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (laeuft) return;
    const grund = pruefePasswort(erstes, email);
    if (grund) return setFehler(grund);
    if (erstes !== zweites) return setFehler("Die beiden Eingaben sind nicht gleich.");
    setLaeuft(true);
    setFehler(null);
    const antwort = await setzeCrewPasswort(erstes);
    setLaeuft(false);
    if (antwort.ok) {
      setFertig(true);
      return;
    }
    setFehler(
      antwort.fehler === "zu_schwach"
        ? (antwort.grund ?? "Das Passwort ist zu schwach.")
        : antwort.fehler === "kein_team"
          ? "Dieses Konto ist nicht fürs Scannen freigeschaltet."
          : antwort.fehler === "zu_oft"
            ? "Zu viele Versuche. Warte ein paar Minuten."
            : "Das hat nicht geklappt. Versuch es bitte noch einmal.",
    );
  }

  return (
    <main className="crew-tor">
      <img src="/crew/lunar-events-wortmarke.png" alt="Lunar Events" width={220} className="crew-wortmarke" />
      {!email ? (
        <div className="card elev-sm crew-tor-karte">
          <span className="card-kicker">Nicht angemeldet</span>
          <p className="card-body">
            Der Link ist abgelaufen oder schon benutzt. Fordere in der Crew-App einen neuen an.
          </p>
        </div>
      ) : fertig ? (
        <div className="card elev-sm crew-tor-karte">
          <span className="card-kicker">Passwort gespeichert</span>
          <p className="card-body">
            Öffne jetzt die Crew-App auf dem Home-Bildschirm und melde dich mit {email} und dem neuen
            Passwort an. Noch nicht installiert? In Safari auf <strong>Teilen → Zum Home-Bildschirm</strong>{" "}
            unter <Link href="/crew">lunar-events.de/crew</Link>.
          </p>
        </div>
      ) : (
        <form className="crew-anmelden" onSubmit={absenden}>
          <h1 className="crew-anmelden-titel">Passwort festlegen</h1>
          <p className="crew-hinweis">Für {email}. Mindestens {PASSWORT_MINDESTLAENGE} Zeichen.</p>
          <div className="field">
            <label htmlFor="crew-neu">Neues Passwort</label>
            <input
              id="crew-neu"
              className="input"
              type="password"
              autoComplete="new-password"
              value={erstes}
              onChange={(e) => setErstes(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="crew-neu-2">Noch einmal</label>
            <input
              id="crew-neu-2"
              className="input"
              type="password"
              autoComplete="new-password"
              value={zweites}
              onChange={(e) => setZweites(e.target.value)}
            />
          </div>
          {fehler ? (
            <p className="crew-fehler" role="alert">
              {fehler}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary crew-hauptknopf" disabled={laeuft}>
            Speichern
          </button>
        </form>
      )}
    </main>
  );
}
