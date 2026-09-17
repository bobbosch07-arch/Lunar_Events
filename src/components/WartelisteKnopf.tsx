"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Knopf, type KnopfStil } from "./Knopf";
import { bestaetigeWarteliste, verlasseWarteliste } from "@/app/aktionen/warteliste";

/**
 * Die Knöpfe auf der Seite eines Warteliste-Eintrags. Erst der Klick ändert
 * etwas, nicht der Aufruf der Seite: Mailprogramme rufen Links für ihre
 * Vorschau selbst auf — sonst wäre bestätigt oder ausgetragen, wer die Mail
 * nur geöffnet hat.
 */
export function WartelisteKnopf({
  token,
  aktion,
  stil = "primaer",
  klasse,
}: {
  token: string;
  aktion: "bestaetigen" | "austragen" | "freigeben";
  stil?: KnopfStil;
  klasse?: string;
}) {
  const t = useTranslations("warteliste");
  const router = useRouter();
  const [fehler, setFehler] = useState(false);
  const [laeuft, starte] = useTransition();

  function los() {
    if (aktion !== "bestaetigen" && !window.confirm(t(`${aktion}Frage`))) return;
    setFehler(false);
    starte(async () => {
      const antwort =
        aktion === "bestaetigen"
          ? await bestaetigeWarteliste(token)
          : await verlasseWarteliste(token);
      if (!antwort.ok) {
        setFehler(true);
        return;
      }
      // Die Seite leitet den neuen Zustand selbst her.
      router.refresh();
    });
  }

  return (
    <>
      <div>
        <Knopf stil={stil} onClick={los} disabled={laeuft}>
          {laeuft ? "…" : t(aktion)}
        </Knopf>
      </div>
      {fehler ? (
        <p className={klasse} role="alert">
          {t("fehler")}
        </p>
      ) : null}
    </>
  );
}
