"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { zaehle } from "./Zaehler";
import { preisText } from "@/lib/format";
import { gemerkteEinladung, gemerkterCode, merkeCode, normalisiereCode } from "@/lib/rabatt";
import { promoAusAdresse } from "@/lib/promoter";
import { pruefePresaleZugang } from "@/app/aktionen/bestellung";
import {
  phasenZustaende,
  verkaufsstand,
  zeigeRest,
  type Phase,
  type VerkaufsStand,
} from "@/lib/typen";
import css from "./Ticketauswahl.module.css";

type Props = {
  eventId: string;
  eventSlug: string;
  phasen: Phase[];
  /** Auf dem Server geprüft, mit Code oder Einladung aus der Adresse. */
  verkauf: VerkaufsStand;
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

  // Presale: Solange kein Zugang da ist, stehen Phasen und Preise sichtbar da,
  // aber ohne Mengenwahl (Rückfragen 17.09.2026).
  const [verkauf, setVerkauf] = useState<VerkaufsStand>(props.verkauf);
  const [presaleOffen, setPresaleOffen] = useState(false);
  const [presaleEingabe, setPresaleEingabe] = useState("");
  const [presaleFehler, setPresaleFehler] = useState<string | null>(null);
  const [presalePrueft, setPresalePrueft] = useState(false);
  const presaleFeld = useRef<HTMLInputElement>(null);
  // Wer aufklappt, will tippen — auf dem Handy sonst ein zweites Antippen.
  // Als Effekt nach dem Zeichnen, nicht über requestAnimationFrame: Das
  // pausiert, solange der Tab nicht gezeichnet wird.
  useEffect(() => {
    if (presaleOffen) presaleFeld.current?.focus();
  }, [presaleOffen]);
  const kaufFrei =
    verkauf.verkauf === "offen" || (verkauf.verkauf === "presale" && verkauf.zugang !== null);

  // Wer schon einen Code oder eine Einladung mitgebracht hat (gemerkt aus
  // einem Link, auch von einer anderen Seite), muss nichts eintippen.
  const eventId = props.eventId;
  const ohneZugang = props.verkauf.verkauf === "presale" && props.verkauf.zugang === null;
  useEffect(() => {
    if (!ohneZugang) return;
    const code = gemerkterCode();
    const einladung = gemerkteEinladung();
    if (!code && !einladung) return;
    let abgebrochen = false;
    void pruefePresaleZugang({ eventId, code, einladung }).then((stand) => {
      if (!abgebrochen && stand.verkauf === "presale" && stand.zugang !== null) setVerkauf(stand);
    });
    return () => {
      abgebrochen = true;
    };
  }, [ohneZugang, eventId]);

  async function presaleFreischalten(e: FormEvent) {
    e.preventDefault();
    const code = normalisiereCode(presaleEingabe);
    if (!code) return;
    setPresalePrueft(true);
    setPresaleFehler(null);
    const stand = await pruefePresaleZugang({ eventId, code, einladung: gemerkteEinladung() });
    setPresalePrueft(false);
    if (stand.verkauf === "offen" || (stand.verkauf === "presale" && stand.zugang !== null)) {
      setVerkauf(stand);
      if (stand.verkauf === "presale" && stand.zugang === "code") merkeCode(stand.code);
      return;
    }
    setPresaleFehler(
      stand.verkauf === "presale" && stand.zugang === null && stand.grund === "aufgebraucht"
        ? t("presaleAufgebraucht")
        : t("presaleUnbekannt"),
    );
  }

  const datum = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

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
    // Ein Code aus einem Link reist mit; eintragen muss ihn niemand.
    const code = gemerkterCode();
    // Das Promoter-Kürzel reist nur in der Adresse — gespeichert wird es nie.
    const promo = promoAusAdresse();
    const einladung = verkauf.verkauf === "presale" ? gemerkteEinladung() : null;
    router.push(
      `/checkout?event=${eventSlug}&p=${teile}` +
        (code ? `&code=${encodeURIComponent(code)}` : "") +
        (promo ? `&promo=${promo}` : "") +
        (einladung ? `&einladung=${einladung}` : ""),
    );
  }

  return (
    <div>
      {verkauf.verkauf === "presale" && verkauf.zugang !== null ? (
        <p className={css.presaleZugang}>
          <span className={css.presaleHaken} aria-hidden="true">
            ✓
          </span>
          {verkauf.zugang === "einladung"
            ? t("presaleMitEinladung", { email: verkauf.email })
            : t("presaleMitCode", { code: verkauf.code })}
        </p>
      ) : null}

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
                ) : gesperrt || folgt || !kaufFrei ? null : (
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

      {!kaufFrei ? (
        <div className={css.presale}>
          {verkauf.verkauf === "bald" ? (
            <p className={css.presaleTitel}>
              {verkauf.presale_ab
                ? t("presaleAb", {
                    presale: datum(verkauf.presale_ab),
                    verkauf: datum(verkauf.verkauf_ab),
                  })
                : t("verkaufAb", { datum: datum(verkauf.verkauf_ab) })}
            </p>
          ) : verkauf.verkauf === "presale" ? (
            <>
              <p className={css.presaleTitel}>{t("presaleLaeuft")}</p>
              <p className={css.presaleText}>
                {t("oeffentlichAb", { datum: datum(verkauf.verkauf_ab) })}. {t("presaleText")}
              </p>
              {presaleOffen ? (
                <form className={css.presaleForm} onSubmit={presaleFreischalten} noValidate>
                  <label className={css.presaleBeschriftung} htmlFor="presale-code">
                    {t("presaleFeld")}
                  </label>
                  <div className={css.presaleReihe}>
                    <input
                      id="presale-code"
                      ref={presaleFeld}
                      className={css.presaleEingabe}
                      value={presaleEingabe}
                      onChange={(ev) => {
                        setPresaleEingabe(ev.target.value);
                        setPresaleFehler(null);
                      }}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      enterKeyHint="done"
                      aria-invalid={presaleFehler ? true : undefined}
                      aria-describedby={presaleFehler ? "presale-fehler" : undefined}
                    />
                    <Knopf
                      type="submit"
                      stil="linie"
                      disabled={presalePrueft || !presaleEingabe.trim()}
                    >
                      {presalePrueft ? "…" : t("presaleOeffnen")}
                    </Knopf>
                  </div>
                  {presaleFehler ? (
                    <span id="presale-fehler" className={css.presaleFehler} role="alert">
                      {presaleFehler}
                    </span>
                  ) : null}
                </form>
              ) : (
                <button
                  type="button"
                  className={css.presaleFrage}
                  onClick={() => setPresaleOffen(true)}
                >
                  {t("presaleFrage")}
                </button>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
