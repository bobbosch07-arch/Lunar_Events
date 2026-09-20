"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { bestaetigeNewsletter, meldeNewsletterAb } from "@/app/aktionen/newsletter";

/**
 * Knopf für Bestätigen oder Abmelden. Erst der Klick wirkt, nicht der Aufruf
 * der Seite: Mailprogramme und Messenger rufen Links für ihre Vorschau selbst
 * auf — sonst wäre jemand bestätigt oder abgemeldet, der nur die Mail
 * geöffnet hat.
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

  if (ergebnis === "ok") {
    return (
      <p className={klasse} role="status">
        {t(art === "bestaetigen" ? "bestaetigenErledigt" : "abmeldenErledigt")}
      </p>
    );
  }

  return (
    <>
      <div>
        <Knopf
          disabled={laeuft}
          onClick={() =>
            starte(async () => {
              const antwort =
                art === "bestaetigen"
                  ? await bestaetigeNewsletter(token)
                  : await meldeNewsletterAb(token);
              setErgebnis(antwort.ok ? "ok" : "fehler");
            })
          }
        >
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
