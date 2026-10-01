"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { bestaetigeNewsletter, meldeNewsletterAb } from "@/app/aktionen/newsletter";

/**
 * Bestätigen oder Abmelden.
 *
 * **Bestätigen** läuft beim Öffnen der Seite von selbst (seit 01.10.2026):
 * Wer in der Mail auf „Anmeldung bestätigen" tippt, hält sich für fertig.
 * Mit einem zweiten Knopf auf der Seite schlossen viele sie vorher und
 * standen nie auf der Liste. Ausgelöst wird es im Browser, nicht beim
 * Aufruf der Seite: Mailprogramme, die Links für ihre Vorschau abrufen,
 * führen in aller Regel kein JavaScript aus.
 *
 * **Abmelden** bleibt ein Knopf: Eine Vorschau, die versehentlich abmeldet,
 * fiele niemandem auf. Für Mailprogramme gibt es die Ein-Klick-Abmeldung
 * über `/api/newsletter/abmelden`.
 */
export function NewsletterAktion({
  token,
  art,
  klasse,
}: {
  token: string;
  art: "bestaetigen" | "abmelden";
  klasse?: string;
}) {
  const t = useTranslations("newsletter");
  const [ergebnis, setErgebnis] = useState<"ok" | "fehler" | null>(null);
  const [laeuft, starte] = useTransition();
  const schonGestartet = useRef(false);

  const ausfuehren = () =>
    starte(async () => {
      const antwort =
        art === "bestaetigen" ? await bestaetigeNewsletter(token) : await meldeNewsletterAb(token);
      setErgebnis(antwort.ok ? "ok" : "fehler");
    });

  useEffect(() => {
    // Im Entwicklungsmodus ruft React Effekte zweimal; einmal reicht.
    if (art !== "bestaetigen" || schonGestartet.current) return;
    schonGestartet.current = true;
    ausfuehren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (ergebnis === "ok") {
    return (
      <p className={klasse} role="status">
        {t(art === "bestaetigen" ? "bestaetigenErledigt" : "abmeldenErledigt")}
      </p>
    );
  }

  // Bestätigen: Während es läuft, nur ein kurzer Hinweis statt eines
  // Knopfes, der zum zweiten Tippen einlädt.
  if (art === "bestaetigen" && ergebnis === null) {
    return (
      <p className={klasse} role="status" aria-live="polite">
        {t("bestaetigenLaeuft")}
      </p>
    );
  }

  return (
    <>
      <div>
        <Knopf disabled={laeuft} onClick={ausfuehren}>
          {laeuft ? "…" : t(art === "bestaetigen" ? "bestaetigenKnopf" : "abmeldenKnopf")}
        </Knopf>
      </div>
      {ergebnis === "fehler" ? (
        <p className={klasse} role="alert">
          {t("fehler")}
        </p>
      ) : null}
    </>
  );
}
