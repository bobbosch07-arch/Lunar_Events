"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Knopf } from "./Knopf";
import { useRouter } from "@/i18n/navigation";
import { meldeMitPasswortAn, sendeAnmeldelink } from "@/app/aktionen/konto";
import css from "./Anmeldung.module.css";

/**
 * `mitPasswort` bietet zusätzlich die Anmeldung per Passwort an. Das ist
 * nur fürs Personal gedacht (Backoffice-Tor) — Gäste sehen es nicht,
 * weil sie keins haben und die Frage nur verunsichern würde.
 */
export function Anmeldung({
  weiter,
  mitPasswort = false,
}: {
  weiter?: string;
  mitPasswort?: boolean;
}) {
  const t = useTranslations("konto");
  const router = useRouter();
  // Gesetzt von /auth/abmelden, wenn eine Personal-Sitzung zu alt war.
  const abgelaufen = useSearchParams().get("abgelaufen") === "1";
  const [art, setArt] = useState<"passwort" | "link">(mitPasswort ? "passwort" : "link");
  const [passwort, setPasswort] = useState("");
  const [email, setEmail] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [gesendet, setGesendet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (laeuft) return;

    setLaeuft(true);
    setFehler(null);

    if (art === "passwort") {
      const antwort = await meldeMitPasswortAn(email, passwort);
      if (antwort.ok) {
        // Die Sitzung steht jetzt in den Cookies. Neu rendern lässt das
        // Layout die Rechte prüfen und das Backoffice zeigen.
        router.refresh();
        return;
      }
      setLaeuft(false);
      setFehler(
        antwort.fehler === "falsch"
          ? "Adresse oder Passwort stimmen nicht."
          : antwort.fehler === "zu_oft"
            ? "Zu viele Versuche. Warte ein paar Minuten."
            : antwort.fehler === "kein_team"
              ? "Dieses Konto hat keinen Backoffice-Zugang."
              : "Das hat nicht geklappt. Versuch es bitte noch einmal.",
      );
      return;
    }

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
      <h2 className={css.titel}>{mitPasswort ? "Backoffice" : t("meineTickets")}</h2>
      <p className={css.text}>
        {mitPasswort ? "Nur für das Lunar-Team." : t("anmeldenText")}
      </p>
      {abgelaufen ? (
        <p className={css.fehlertext} role="status">
          Deine Anmeldung ist abgelaufen. Aus Sicherheitsgründen gilt sie nur
          einige Stunden — bitte melde dich neu an.
        </p>
      ) : null}

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
        {mitPasswort ? null : (
          <span className={css.hinweis}>
            Nimm die Adresse, an die deine Tickets gegangen sind — dann findest du
            auch Käufe wieder, die du ohne Konto gemacht hast.
          </span>
        )}
      </div>

      {art === "passwort" ? (
        <div className={css.feld}>
          <label className={css.beschriftung} htmlFor="anmelde-passwort">
            Passwort
          </label>
          <input
            id="anmelde-passwort"
            type="password"
            autoComplete="current-password"
            className={`${css.eingabe} ${fehler ? css.fehlerhaft : ""}`}
            value={passwort}
            aria-invalid={fehler ? true : undefined}
            onChange={(e) => {
              setPasswort(e.target.value);
              setFehler(null);
            }}
          />
        </div>
      ) : null}

      {fehler ? <p className={css.fehlertext}>{fehler}</p> : null}

      <Knopf type="submit" disabled={laeuft} voll>
        {laeuft ? "…" : art === "passwort" ? t("anmeldenTitel") : t("linkSenden")}
      </Knopf>

      {mitPasswort ? (
        <button
          type="button"
          className={css.nochmal}
          onClick={() => {
            setArt((a) => (a === "passwort" ? "link" : "passwort"));
            setFehler(null);
          }}
        >
          {art === "passwort"
            ? "Kein Passwort? Anmeldelink per Mail schicken"
            : "Mit Passwort anmelden"}
        </button>
      ) : null}
    </form>
  );
}
