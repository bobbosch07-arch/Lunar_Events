"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { trageAufWarteliste, type EintragErgebnis } from "@/app/aktionen/warteliste";
import { ANGEBOT_STUNDEN, WARTELISTE_MAX_TICKETS } from "@/lib/typen";
import css from "./Warteliste.module.css";

/**
 * Das Formular unter einer ausverkauften Ticketauswahl (0020).
 *
 * Auf der Liste steht erst, wer den Link aus der Mail bestätigt — deshalb
 * endet das Formular nicht mit „Du bist drauf", sondern mit dem Hinweis aufs
 * Postfach.
 */
export function Warteliste({ eventId }: { eventId: string }) {
  const t = useTranslations("warteliste");
  const [email, setEmail] = useState("");
  const [vorname, setVorname] = useState("");
  const [anzahl, setAnzahl] = useState(1);
  const [falle, setFalle] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erledigt, setErledigt] = useState<Extract<EintragErgebnis, { ok: true }>["art"] | null>(
    null,
  );

  async function absenden(e: FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email.trim())) {
      setFehler(t("fehlerEmail"));
      document.getElementById("warteliste-email")?.focus();
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const antwort = await trageAufWarteliste({ eventId, email, vorname, anzahl, falle }).catch(
      () => ({ ok: false as const, fehler: "versand" as const }),
    );
    setLaeuft(false);
    if (antwort.ok) {
      setErledigt(antwort.art);
      return;
    }
    setFehler(
      antwort.fehler === "email"
        ? t("fehlerEmail")
        : antwort.fehler === "nicht_ausverkauft"
          ? t("fehlerNichtAusverkauft")
          : antwort.fehler === "event_zu"
            ? t("fehlerEventZu")
            : t("fehlerVersand"),
    );
  }

  return (
    <div className={css.box}>
      <p className={css.titel}>{t("titel")}</p>

      {erledigt ? (
        <p className={css.erledigt} role="status">
          <span className={css.haken} aria-hidden="true">
            ✓
          </span>
          <span>
            {erledigt === "schon_drauf"
              ? t("schonDrauf", { email: email.trim() })
              : t("mailUnterwegs", { email: email.trim() })}
          </span>
        </p>
      ) : (
        <>
          <p className={css.text}>{t("text", { stunden: ANGEBOT_STUNDEN })}</p>
          <form className={css.form} onSubmit={absenden} noValidate>
            <div className={`${css.feld} ${css.feldEmail}`}>
              <label className={css.beschriftung} htmlFor="warteliste-email">
                {t("email")}
              </label>
              <input
                id="warteliste-email"
                type="email"
                className={css.eingabe}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFehler(null);
                }}
                autoComplete="email"
                spellCheck={false}
                aria-invalid={fehler === t("fehlerEmail") ? true : undefined}
                aria-describedby={fehler ? "warteliste-fehler" : undefined}
              />
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="warteliste-vorname">
                {t("vorname")}
              </label>
              <input
                id="warteliste-vorname"
                className={css.eingabe}
                value={vorname}
                onChange={(e) => setVorname(e.target.value)}
                autoComplete="given-name"
                spellCheck={false}
              />
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="warteliste-anzahl">
                {t("anzahl")}
              </label>
              <select
                id="warteliste-anzahl"
                className={css.eingabe}
                value={anzahl}
                onChange={(e) => setAnzahl(Number(e.target.value))}
              >
                {Array.from({ length: WARTELISTE_MAX_TICKETS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className={css.falle} aria-hidden="true">
              <label htmlFor="warteliste-firma">Firma (bitte frei lassen)</label>
              <input
                id="warteliste-firma"
                name="firma"
                tabIndex={-1}
                autoComplete="off"
                value={falle}
                onChange={(e) => setFalle(e.target.value)}
              />
            </div>

            {fehler ? (
              <p id="warteliste-fehler" className={css.fehler} role="alert">
                {fehler}
              </p>
            ) : null}

            <div className={css.fuss}>
              <Knopf type="submit" disabled={laeuft}>
                {laeuft ? "…" : t("knopf")}
              </Knopf>
              <span className={css.hinweis}>
                {t("hinweis")} <Link href="/datenschutz">{t("datenschutz")}</Link>
              </span>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
