"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { trageInVerteilerEin } from "@/app/aktionen/newsletter";
import css from "./Newsletter.module.css";

export function Newsletter() {
  const t = useTranslations("footer");
  const [email, setEmail] = useState("");
  const [fertig, setFertig] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  if (fertig) {
    return (
      <div className={css.block}>
        <p className={css.danke}>{t("newsletterDanke")}</p>
      </div>
    );
  }

  return (
    <form
      className={css.block}
      onSubmit={(e) => {
        e.preventDefault();
        setFehler(null);
        starte(async () => {
          const antwort = await trageInVerteilerEin(email);
          if (antwort.ok) setFertig(true);
          else
            setFehler(
              antwort.fehler === "email"
                ? "Diese Adresse stimmt nicht."
                : antwort.fehler === "kein_versand"
                  ? "Newsletter-Anmeldung ist gerade nicht möglich."
                  : "Das hat gerade nicht geklappt.",
            );
        });
      }}
    >
      <span className={css.titel}>{t("newsletterTitel")}</span>
      <p className={css.text}>{t("newsletterText")}</p>

      <div className={css.zeile}>
        <label className="nur-sr" htmlFor="newsletter-email">
          {t("newsletterFeld")}
        </label>
        <input
          id="newsletter-email"
          type="email"
          autoComplete="email"
          placeholder={t("newsletterFeld")}
          className={css.eingabe}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setFehler(null);
          }}
        />
        <button type="submit" className={css.knopf} disabled={laeuft}>
          {laeuft ? "…" : t("newsletterCta")}
        </button>
      </div>

      {fehler ? <p className={css.fehler}>{fehler}</p> : null}
    </form>
  );
}
