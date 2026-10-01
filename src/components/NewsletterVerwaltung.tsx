"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import {
  entferneAbonnent,
  legeAusgabeAn,
  sendeAusgabe,
  sendeNewsletterTest,
} from "@/app/aktionen/newsletter";
import css from "./EventFormular.module.css";
import bo from "@/app/[locale]/backoffice/backoffice.module.css";

/**
 * Ruft `sendeAusgabe` so lange nach, bis nichts mehr offen ist oder der
 * Anbieter ablehnt. Ein Aufruf schickt höchstens 50 Mails; so bleibt jeder
 * weit unter der Zeitgrenze einer Serverfunktion.
 */
async function versendeBisFertig(
  ausgabeId: string,
  melde: (text: string) => void,
): Promise<string> {
  let gesamt = 0;
  for (;;) {
    const antwort = await sendeAusgabe(ausgabeId);
    gesamt += antwort.verschickt;
    if (!antwort.ok) {
      return `${gesamt} verschickt, ${antwort.offen} offen. Abgebrochen: ${antwort.grund}`;
    }
    if (antwort.offen === 0) return `Fertig: ${gesamt} verschickt.`;
    // Kein Fortschritt ohne Fehler kommt nicht vor; sicher ist sicher.
    if (antwort.verschickt === 0) return `${gesamt} verschickt, ${antwort.offen} offen.`;
    melde(`${gesamt} verschickt, ${antwort.offen} noch offen …`);
  }
}

export type EventOption = { id: string; name: string };

export function NewsletterVerfassen({
  empfaenger,
  events,
}: {
  empfaenger: number;
  events: EventOption[];
}) {
  const router = useRouter();
  const [betreff, setBetreff] = useState("");
  const [text, setText] = useState("");
  const [eventId, setEventId] = useState("");
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);
  const [laeuft, starte] = useTransition();

  const entwurf = () => ({ betreff, text, eventId: eventId || null });
  const vollstaendig = betreff.trim().length > 0 && text.trim().length > 0;

  return (
    <section className={css.gruppe}>
      <h2 className={css.gruppenTitel}>Neue Mail</h2>

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="nl-betreff">
          Betreff
        </label>
        <input
          id="nl-betreff"
          className={css.eingabe}
          maxLength={150}
          value={betreff}
          onChange={(e) => setBetreff(e.target.value)}
          placeholder="THE OPENING: Line-up steht"
        />
        <span className={css.hinweis}>Steht auch groß im Kopf der Mail.</span>
      </div>

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="nl-text">
          Text
        </label>
        <textarea
          id="nl-text"
          className={css.textfeld}
          rows={8}
          maxLength={10000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className={css.hinweis}>
          Leerzeile = neuer Absatz. Adressen mit https:// werden automatisch zu Links. Den
          Abmeldelink setzt die Mail selbst darunter.
        </span>
      </div>

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="nl-event">
          Event (optional)
        </label>
        <select
          id="nl-event"
          className={css.auswahl}
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="">Kein Event</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className={css.hinweis}>
          Hängt Poster, Datum, Ort und einen Knopf „Zu den Tickets“ unter den Text.
        </span>
      </div>

      {meldung ? (
        <p className={meldung.fehler ? css.stoerung : css.hinweis} role="status">
          {meldung.text}
        </p>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Knopf
          stil="linie"
          disabled={laeuft || !vollstaendig}
          onClick={() =>
            starte(async () => {
              setMeldung(null);
              const antwort = await sendeNewsletterTest(entwurf());
              setMeldung(
                antwort.ok
                  ? { text: `Testmail an ${antwort.an} ist raus. Schau sie dir an, bevor sie an alle geht.`, fehler: false }
                  : { text: antwort.grund, fehler: true },
              );
            })
          }
        >
          Testmail an mich
        </Knopf>
        <Knopf
          disabled={laeuft || !vollstaendig || empfaenger === 0}
          onClick={() => {
            const ok = window.confirm(
              `„${betreff.trim()}“ jetzt an ${empfaenger} ${empfaenger === 1 ? "Adresse" : "Adressen"} schicken?\n\nDas lässt sich nicht zurückholen.`,
            );
            if (!ok) return;
            starte(async () => {
              setMeldung({ text: "Wird verschickt …", fehler: false });
              const angelegt = await legeAusgabeAn(entwurf());
              if (!angelegt.ok) {
                setMeldung({ text: angelegt.grund, fehler: true });
                return;
              }
              const ende = await versendeBisFertig(angelegt.id, (t) =>
                setMeldung({ text: t, fehler: false }),
              );
              setMeldung({ text: ende, fehler: !ende.startsWith("Fertig") });
              if (ende.startsWith("Fertig")) {
                setBetreff("");
                setText("");
                setEventId("");
              }
              router.refresh();
            });
          }}
        >
          {laeuft ? "…" : `An alle senden (${empfaenger})`}
        </Knopf>
      </div>
    </section>
  );
}

/** Für eine Ausgabe, deren Versand abgebrochen ist (meist das Tageslimit). */
export function AusgabeFortsetzen({ ausgabeId }: { ausgabeId: string }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <Knopf
        stil="linie"
        groesse="klein"
        disabled={laeuft}
        onClick={() =>
          starte(async () => {
            const ende = await versendeBisFertig(ausgabeId, setMeldung);
            setMeldung(ende);
            router.refresh();
          })
        }
      >
        {laeuft ? "…" : "Fortsetzen"}
      </Knopf>
      {meldung ? (
        <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-secondary)", maxWidth: "32ch" }}>
          {meldung}
        </span>
      ) : null}
    </div>
  );
}

/** Adresse ganz aus dem Verteiler nehmen, etwa auf Löschwunsch. */
export function AbonnentEntfernen({ email }: { email: string }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState(false);

  return (
    <button
      type="button"
      className={bo.textknopf}
      disabled={laeuft}
      onClick={() => {
        if (!window.confirm(`${email} endgültig aus dem Verteiler löschen?`)) return;
        starte(async () => {
          const antwort = await entferneAbonnent(email);
          setFehler(!antwort.ok);
          if (antwort.ok) router.refresh();
        });
      }}
    >
      {laeuft ? "…" : fehler ? "Fehlgeschlagen" : "Entfernen"}
    </button>
  );
}
