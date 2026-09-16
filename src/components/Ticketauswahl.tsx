"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { zaehle } from "./Zaehler";
import { preisText } from "@/lib/format";
import { phasenZustaende, verkaufsstand, zeigeRest, type Phase } from "@/lib/typen";
import css from "./Ticketauswahl.module.css";

type Props = {
  eventId: string;
  eventSlug: string;
  phasen: Phase[];
};

/** Mehr als zwanzig Tickets auf einmal ist keine Bestellung, das ist eine
 *  Gruppenanfrage — die läuft über VIP. Zwanzig laut Fragebogen vom
 *  16.09.2026; dieselbe Grenze prüft die Kasse (checkout/page.tsx). */
const MAX_JE_PHASE = 20;

export function Ticketauswahl(props: Props) {
  const { eventSlug, phasen } = props;
  const t = useTranslations("event");
  const locale = useLocale();
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<Record<string, number>>({});
  // Nur die erste Wahl zählt: Wer zwischen zwei Phasen hin- und
  // herklickt, ist trotzdem ein Interessent, nicht fünf.
  const gezaehlt = useRef(false);

  const zustaende = useMemo(() => phasenZustaende(phasen), [phasen]);

  const { summe, anzahl } = useMemo(() => {
    let summe = 0;
    let anzahl = 0;
    for (const p of phasen) {
      const menge = auswahl[p.id] ?? 0;
      if (menge > 0) {
        summe += (p.preis_cent + p.gebuehr_cent) * menge;
        anzahl += menge;
      }
    }
    return { summe, anzahl };
  }, [auswahl, phasen]);

  function aendere(phase: Phase, richtung: 1 | -1) {
    const zustand = zustaende.get(phase.id);
    const rest = zustand?.art === "kaufbar" ? zustand.rest : null;
    const obergrenze = Math.min(MAX_JE_PHASE, rest ?? MAX_JE_PHASE);

    if (richtung === 1 && !gezaehlt.current) {
      gezaehlt.current = true;
      zaehle("ticket_gewaehlt", props.eventId);
    }

    setAuswahl((alt) => {
      const jetzt = alt[phase.id] ?? 0;
      const neu = Math.max(0, Math.min(obergrenze, jetzt + richtung));
      if (neu === 0) {
        const { [phase.id]: _weg, ...rest } = alt;
        return rest;
      }
      return { ...alt, [phase.id]: neu };
    });
  }

  function weiter() {
    // Die Auswahl steht in der Adresse, damit sie einen Neuladen des
    // Browsers übersteht und sich weiterreichen lässt.
    const teile = Object.entries(auswahl)
      .map(([id, menge]) => `${id}:${menge}`)
      .join(",");
    router.push(`/checkout?event=${eventSlug}&p=${teile}`);
  }

  return (
    <div>
      <div className={css.liste}>
        {phasen.map((phase) => {
          const zustand = zustaende.get(phase.id)!;
          const menge = auswahl[phase.id] ?? 0;
          const rest = zeigeRest(zustand);
          const gesperrt = zustand.art === "ausverkauft" || zustand.art === "vorbei";
          const folgt = zustand.art === "folgt";
          const stand = verkaufsstand(phase, phasen, zustaende);

          const klassen = [
            css.phase,
            menge > 0 ? css.gewaehlt : null,
            gesperrt ? css.aus : null,
            folgt ? css.folgt : null,
            phase.art === "vip" ? css.vip : null,
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={phase.id} className={klassen}>
              <div className={css.links}>
                <div className={css.kopf}>
                  <span className={css.name}>{phase.name}</span>
                  <span
                    className={`${css.zustand} ${rest !== null ? css.knapp : ""}`}
                  >
                    {zustand.art === "folgt"
                      ? t("folgt", { phase: zustand.nach })
                      : zustand.art === "ausverkauft"
                      ? t("ausverkauft")
                      : zustand.art === "vorbei"
                        ? t("ausverkauft")
                        : zustand.art === "spaeter"
                          ? t("baldVerfuegbar", {
                              datum: new Intl.DateTimeFormat(locale, {
                                day: "2-digit",
                                month: "long",
                              }).format(new Date(zustand.ab)),
                            })
                          : rest !== null
                            ? t("nochVerfuegbar", { anzahl: rest })
                            : zustand.art === "anfrage"
                              ? ""
                              : t("verfuegbar")}
                  </span>
                </div>

                {stand ? (
                  <div
                    className={`${css.stand} ${stand.anteil >= 0.8 ? css.standFast : ""}`}
                  >
                    <div
                      className={css.standBalken}
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(stand.anteil * 100)}
                      aria-label={t("fomoVerkauft", {
                        prozent: Math.round(stand.anteil * 100),
                      })}
                    >
                      <span
                        className={css.standFuellung}
                        style={{ width: `${Math.max(4, Math.round(stand.anteil * 100))}%` }}
                      />
                    </div>
                    <div className={css.standText}>
                      <span>
                        {t("fomoVerkauft", { prozent: Math.round(stand.anteil * 100) })}
                      </span>
                      <span>
                        {stand.naechste
                          ? t("fomoDanach", {
                              phase: stand.naechste.name,
                              preis: preisText(
                                stand.naechste.preis_cent + stand.naechste.gebuehr_cent,
                                locale,
                              ),
                            })
                          : t("fomoLetzte")}
                      </span>
                    </div>
                  </div>
                ) : null}

                {phase.beschreibung ? (
                  <p className={css.beschreibung}>{phase.beschreibung}</p>
                ) : null}

                {phase.leistungen.length > 0 ? (
                  <ul className={css.leistungen}>
                    {phase.leistungen.map((l) => (
                      <li key={l} className={css.leistung}>
                        <span className={css.haken} aria-hidden="true">
                          ✓
                        </span>
                        {l}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className={css.rechts}>
                <div className={css.preisfeld}>
                  <span className={css.preis}>
                    {phase.art === "vip"
                      ? t("aufAnfrage")
                      : preisText(phase.preis_cent + phase.gebuehr_cent, locale)}
                  </span>
                  {phase.art !== "vip" && phase.gebuehr_cent > 0 ? (
                    <span className={css.gebuehr}>
                      inkl. {preisText(phase.gebuehr_cent, locale)} Gebühr
                    </span>
                  ) : null}
                </div>

                {phase.art === "vip" ? (
                  <Knopf
                    href={`/vip?event=${eventSlug}`}
                    stil="gold"
                    groesse="klein"
                  >
                    {t("anfragen")}
                  </Knopf>
                ) : gesperrt || folgt ? null : (
                  <div className={css.menge}>
                    <button
                      type="button"
                      className={css.mengeKnopf}
                      onClick={() => aendere(phase, -1)}
                      disabled={menge === 0}
                      aria-label={`${phase.name}: eines weniger`}
                    >
                      −
                    </button>
                    <span
                      className={css.mengeWert}
                      aria-live="polite"
                      aria-label={`${phase.name}: ${menge}`}
                    >
                      {menge}
                    </span>
                    <button
                      type="button"
                      className={css.mengeKnopf}
                      onClick={() => aendere(phase, 1)}
                      disabled={
                        zustand.art === "kaufbar" &&
                        menge >= Math.min(MAX_JE_PHASE, zustand.rest ?? MAX_JE_PHASE)
                      }
                      aria-label={`${phase.name}: eines mehr`}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Schwebt erst, wenn es etwas zu bezahlen gibt. Leer stünde sie nur
          im Weg, über den Phasen, die man gerade lesen will. */}
      <div className={css.summe} data-leer={anzahl === 0 ? "" : undefined}>
        <div className={css.summeLinks}>
          {anzahl > 0 ? (
            <>
              <div className={css.summeZeile}>
                <span className={css.summeLabel}>{t("summe")}</span>
                <span className={css.summeWert}>{preisText(summe, locale)}</span>
              </div>
              <span className={css.summeDetail}>
                {anzahl} {anzahl === 1 ? "Ticket" : "Tickets"} · inkl. Gebühren
              </span>
            </>
          ) : (
            <span className={css.leerHinweis}>{t("nichtsGewaehlt")}</span>
          )}
        </div>

        <Knopf onClick={weiter} disabled={anzahl === 0} groesse="gross">
          <span className={css.weiterLang}>{t("weiter")}</span>
          <span className={css.weiterKurz}>{t("weiterKurz")}</span>
        </Knopf>
      </div>
    </div>
  );
}
