"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { sendePresaleEinladungen } from "@/app/aktionen/presale";
import css from "./EventFormular.module.css";

export type EinladungStand = {
  /** Frühere Gäste, die eingeladen werden dürfen (inkl. schon eingeladener) */
  moeglich: number;
  verschickt: number;
  gekauft: number;
};

/**
 * Einladungen an frühere Gäste, auf der Bearbeiten-Seite eines Events mit
 * Presale. Die Zahlen kommen vom Server; der Knopf verschickt je Klick einen
 * Stapel und zeigt, was übrig ist.
 */
export function PresaleEinladungen({
  eventId,
  stand,
  darfSenden,
  presaleLaeuftNoch,
}: {
  eventId: string;
  stand: EinladungStand;
  darfSenden: boolean;
  presaleLaeuftNoch: boolean;
}) {
  const router = useRouter();
  const [meldung, setMeldung] = useState<{ art: "gut" | "schlecht"; text: string } | null>(null);
  const [laeuft, starte] = useTransition();

  function senden() {
    const sicher = window.confirm(
      "Einladungen jetzt per Mail verschicken? Jeder frühere Gast bekommt genau eine — " +
        "wer schon eingeladen ist, bekommt keine zweite.",
    );
    if (!sicher) return;
    setMeldung(null);
    starte(async () => {
      const antwort = await sendePresaleEinladungen(eventId);
      if (!antwort.ok) {
        setMeldung({ art: "schlecht", text: antwort.fehler });
        return;
      }
      const teile = [`${antwort.verschickt} verschickt`];
      if (antwort.fehlgeschlagen > 0) {
        teile.push(
          `${antwort.fehlgeschlagen} nicht angekommen beim Mailanbieter (Tageslimit? Morgen noch einmal drücken)`,
        );
      }
      if (antwort.offen > 0) teile.push(`${antwort.offen} noch offen — noch einmal drücken`);
      setMeldung({
        art: antwort.fehlgeschlagen > 0 && antwort.verschickt === 0 ? "schlecht" : "gut",
        text: teile.join(" · ") + ".",
      });
      router.refresh();
    });
  }

  return (
    <section className={css.gruppe}>
      <h2 className={css.gruppenTitel}>Presale-Einladungen an frühere Gäste</h2>
      <p className={css.hinweis} style={{ fontSize: "var(--fs-body-s)" }}>
        <strong>{stand.moeglich}</strong> frühere Gäste dürfen eingeladen werden ·{" "}
        <strong>{stand.verschickt}</strong> eingeladen · <strong>{stand.gekauft}</strong> haben
        über ihre Einladung gekauft
      </p>
      <span className={css.hinweis}>
        Eingeladen wird, wer für ein anderes Event bezahlt hat, dabei den Hinweis auf
        Einladungen in der Kasse gesehen hat (Käufe ab 17.09.2026) und sich nicht abgemeldet
        hat. Jede Mail hat einen Abmeldelink. Der Link in der Mail gilt nur für die
        eingeladene Adresse. Pro Klick gehen bis zu 60 Mails raus; Brevo schafft kostenlos
        300 am Tag.
      </span>
      {darfSenden && presaleLaeuftNoch ? (
        <div>
          <Knopf onClick={senden} disabled={laeuft || stand.moeglich === 0}>
            {laeuft ? "Verschicke …" : "Einladungen verschicken"}
          </Knopf>
        </div>
      ) : !presaleLaeuftNoch ? (
        <span className={css.hinweis}>Der öffentliche Verkauf läuft schon — keine Einladungen mehr.</span>
      ) : null}
      {meldung ? (
        <p className={meldung.art === "gut" ? css.erfolg : css.stoerung}>{meldung.text}</p>
      ) : null}
    </section>
  );
}
