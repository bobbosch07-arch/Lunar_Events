"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { aendereTicketname, type NamensErgebnis } from "@/app/aktionen/ticketname";
import { bereinigeName, istTicketname, TICKETNAME_MAX } from "@/lib/ticketname";
import css from "./TicketNameAendern.module.css";
import kasse from "./Checkout.module.css";

const GRUND: Record<Extract<NamensErgebnis, { ok: false }>["grund"], string> = {
  name: "fehler",
  doppelt: "doppelt",
  zu_spaet: "zuSpaet",
  nicht_gueltig: "nichtGueltig",
  unbekannt: "allgemein",
  fehler: "allgemein",
};

/**
 * Unter einem gekauften Ticket (0046): den Namen ändern, oder bei
 * Bestellungen von vor den Namen nachtragen. Fehlt der Name, steht das Feld
 * gleich offen. Die Seite zeigt das nur bis Eventbeginn; ob es dann noch
 * geht, entscheidet die Datenbank.
 */
export function TicketNameAendern({
  token,
  code,
  name,
}: {
  token: string;
  code: string;
  name: string | null;
}) {
  const t = useTranslations("ticket.name");
  const router = useRouter();
  const [offen, setOffen] = useState(!name);
  const [wert, setWert] = useState(name ?? "");
  const [fehler, setFehler] = useState<string | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  const [laeuft, starte] = useTransition();
  const feldId = `name-${code}`;

  function speichern(e: FormEvent) {
    e.preventDefault();
    const sauber = bereinigeName(wert);
    if (!istTicketname(sauber)) {
      setFehler(t("fehler"));
      return;
    }
    if (sauber === name) {
      setOffen(false);
      return;
    }
    starte(async () => {
      const antwort = await aendereTicketname(token, code, sauber);
      if (!antwort.ok) {
        setFehler(t(GRUND[antwort.grund]));
        return;
      }
      setGespeichert(true);
      setOffen(false);
      // Die Ticketkarte darüber zeigt den Namen; sie kommt vom Server.
      router.refresh();
    });
  }

  if (!offen) {
    return (
      <p className={css.zeile}>
        {gespeichert ? <span className={css.gespeichert}>{t("gespeichert")}</span> : null}
        <button
          type="button"
          className={css.textknopf}
          onClick={() => {
            setWert(name ?? "");
            setFehler(null);
            setGespeichert(false);
            setOffen(true);
          }}
        >
          {t("aendern")}
        </button>
      </p>
    );
  }

  return (
    <form className={css.form} onSubmit={speichern} noValidate>
      {name ? null : <span className={css.fehlt}>{t("fehlt")}</span>}
      <label className={kasse.beschriftung} htmlFor={feldId}>
        {t("feld")}
      </label>
      <div className={css.reihe}>
        <input
          id={feldId}
          className={`${kasse.eingabe} ${fehler ? kasse.eingabeFehler : ""}`}
          value={wert}
          onChange={(e) => {
            setWert(e.target.value);
            setFehler(null);
          }}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={TICKETNAME_MAX}
          enterKeyHint="done"
          aria-invalid={fehler ? true : undefined}
          aria-describedby={fehler ? `${feldId}-fehler` : undefined}
        />
        <Knopf type="submit" groesse="klein" disabled={laeuft}>
          {laeuft ? "…" : name ? t("speichern") : t("eintragen")}
        </Knopf>
      </div>
      {fehler ? (
        <span id={`${feldId}-fehler`} className={kasse.fehlertext} role="alert">
          {fehler}
        </span>
      ) : null}
      {name ? (
        <button
          type="button"
          className={css.textknopf}
          onClick={() => {
            setOffen(false);
            setFehler(null);
          }}
        >
          {t("abbrechen")}
        </button>
      ) : null}
    </form>
  );
}
