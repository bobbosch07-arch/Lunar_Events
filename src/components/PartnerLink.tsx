"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { KopierFeld } from "./KopierFeld";
import { entfernePartnerLink, erzeugePartnerLink } from "@/app/aktionen/partnerlink";
import css from "./EventFormular.module.css";

/**
 * Der Partnerlink eines Events (0047) auf seiner Übersicht im Backoffice:
 * erzeugen, kopieren, erneuern, abschalten. Alle Partner teilen sich den
 * einen Link; wer nicht mehr reinschauen soll, bekommt einen neuen nicht.
 */
export function PartnerLink({ eventId, link }: { eventId: string; link: string | null }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<string | null>(null);

  const ausfuehren = (aktion: () => Promise<{ ok: true } | { ok: false; fehler: string }>, erfolg: string) =>
    starte(async () => {
      const antwort = await aktion();
      setMeldung(antwort.ok ? erfolg : antwort.fehler);
      if (antwort.ok) router.refresh();
    });

  return (
    <section className={css.gruppe} style={{ maxWidth: 940, marginTop: "2rem" }}>
      <h2 className={css.gruppenTitel}>Partnerlink</h2>
      <span className={css.hinweis}>
        Für Geschäftspartner, ohne Anmeldung: Wer diesen Link hat, sieht die bezahlten
        Online-Bestellungen dieses Events mit Namen und Ticketanzahl. Keine Mailadressen, keine
        Beträge. Gib ihn nur an Partner weiter.
      </span>
      {link ? (
        <>
          <KopierFeld
            wert={link}
            beschriftung="Kopieren"
            kopiert="Kopiert"
            klasse={css.leistungszeile}
            wertKlasse={`${css.eingabe} ${css.linkwert}`}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Knopf
              stil="linie"
              groesse="klein"
              disabled={laeuft}
              onClick={() => {
                if (
                  window.confirm(
                    "Neuen Partnerlink erzeugen? Der bisherige funktioniert danach nicht mehr. " +
                      "Schick den neuen an alle, die weiter reinschauen sollen.",
                  )
                ) {
                  ausfuehren(() => erzeugePartnerLink(eventId), "Neuer Link erzeugt.");
                }
              }}
            >
              Neuen Link erzeugen
            </Knopf>
            <Knopf
              stil="linie"
              groesse="klein"
              disabled={laeuft}
              onClick={() => {
                if (window.confirm("Partnerlink abschalten? Er funktioniert danach nicht mehr.")) {
                  ausfuehren(() => entfernePartnerLink(eventId), "Link abgeschaltet.");
                }
              }}
            >
              Abschalten
            </Knopf>
          </div>
        </>
      ) : (
        <div>
          <Knopf
            stil="primaer"
            groesse="klein"
            disabled={laeuft}
            onClick={() => ausfuehren(() => erzeugePartnerLink(eventId), "Link erzeugt.")}
          >
            {laeuft ? "…" : "Partnerlink erzeugen"}
          </Knopf>
        </div>
      )}
      {meldung ? <span className={css.hinweis}>{meldung}</span> : null}
    </section>
  );
}
