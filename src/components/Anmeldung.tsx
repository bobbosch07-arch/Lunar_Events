"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { sendeAnmeldelink } from "@/app/aktionen/konto";
import css from "./Anmeldung.module.css";

export function Anmeldung({ weiter }: { weiter?: string }) {
  const t = useTranslations("konto");
  const [email, setEmail] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [gesendet, setGesendet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (laeuft) return;

    setLaeuft(true);
    setFehler(null);

    const ergebnis = await sendeAnmeldelink(email, weiter);
    setLaeuft(false);

    if (ergebnis.ok) {
      setGesendet(true);
      return;
    }
    setFehler(
      ergebnis.fehler === "email"
        ? "Diese E-Mail-Adresse stimmt nicht."
        : ergebnis.fehler === "zu_oft"
          ? "Zu viele Versuche. Warte ein paar Minuten."
          : "Das hat nicht geklappt. Versuch es bitte noch einmal.",
    );
  }

  if (gesendet) {
    return (
      <div className={css.karte}>
        <span className="eyebrow">{t("anmeldenTitel")}</span>
        <h2 className={css.titel}>{t("linkGesendet")}</h2>
        <p className={css.text}>
          Wir haben eine Nachricht an <strong>{email}</strong> geschickt. Der
          Link gilt eine Stunde. Nichts angekommen? Schau im Spam nach.
        </p>
        <button
          type="button"
          className={css.nochmal}
          onClick={() => setGesendet(false)}
        >
          Andere Adresse verwenden
        </button>
      </div>
    );
  }

  return (
    <form className={css.karte} onSubmit={absenden} noValidate>
      <span className="eyebrow">{t("anmeldenTitel")}</span>
      <h2 className={css.titel}>{t("meineTickets")}</h2>
      <p className={css.text}>{t("anmeldenText")}</p>

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="anmelde-email">
          E-Mail
        </label>
        <input
          id="anmelde-email"
          type="email"
          autoComplete="email"
          spellCheck={false}
          className={`${css.eingabe} ${fehler ? css.fehlerhaft : ""}`}
          value={email}
          aria-invalid={fehler ? true : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            setFehler(null);
          }}
        />
        <span className={css.hinweis}>
          Nimm die Adresse, an die deine Tickets gegangen sind — dann findest du
          auch Käufe wieder, die du ohne Konto gemacht hast.
        </span>
      </div>

      {fehler ? <p className={css.fehlertext}>{fehler}</p> : null}

      <Knopf type="submit" disabled={laeuft} voll>
        {laeuft ? "…" : t("linkSenden")}
      </Knopf>
    </form>
  );
}
