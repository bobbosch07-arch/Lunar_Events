"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { meldeWerbungAb } from "@/app/aktionen/werbung";

/**
 * Der Knopf zum Abmelden. Erst der Klick meldet ab, nicht der Aufruf der
 * Seite: Mailprogramme und Messenger rufen Links für ihre Vorschau selbst
 * auf — sonst wäre jemand abgemeldet, der nur die Mail geöffnet hat.
 */
export function WerbungAbmelden({ token, klasse }: { token: string; klasse?: string }) {
  const t = useTranslations("werbung");
  const [ergebnis, setErgebnis] = useState<"ok" | "fehler" | null>(null);
  const [laeuft, starte] = useTransition();

  if (ergebnis === "ok") {
    return (
      <p className={klasse} role="status">
        {t("erledigt")}
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
              const antwort = await meldeWerbungAb(token);
              setErgebnis(antwort.ok ? "ok" : "fehler");
            })
          }
        >
          {laeuft ? "…" : t("knopf")}
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
