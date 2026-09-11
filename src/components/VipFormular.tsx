"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import { sendeVipAnfrage } from "@/app/aktionen/vip";
import css from "./VipFormular.module.css";

export type EventWahl = { id: string; titel: string; slug: string; wann: string };

type Props = {
  events: EventWahl[];
  /** Kommt jemand aus einem Eventdetail, ist das Event vorbelegt. */
  vorauswahl?: string;
};

const PAKETE = [
  "Tisch für 4–6 Gäste",
  "Tisch für 6–10 Gäste",
  "Großer Tisch ab 10 Gästen",
  "Noch offen",
] as const;

type Felder = {
  name: string;
  email: string;
  telefon: string;
  eventId: string;
  gaeste: string;
  wunschdatum: string;
  paket: string;
  nachricht: string;
};

const LEER: Felder = {
  name: "",
  email: "",
  telefon: "",
  eventId: "",
  gaeste: "6",
  wunschdatum: "",
  paket: "",
  nachricht: "",
};

export function VipFormular({ events, vorauswahl }: Props) {
  const t = useTranslations("vip");
  const [felder, setFelder] = useState<Felder>({
    ...LEER,
    eventId: events.find((e) => e.slug === vorauswahl)?.id ?? "",
  });
  const [falle, setFalle] = useState("");
  const [fehler, setFehler] = useState<Partial<Record<keyof Felder, boolean>>>({});
  const [stoerung, setStoerung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [gesendet, setGesendet] = useState(false);
  const aufgebaut = useRef(Date.now());

  function setze<K extends keyof Felder>(schluessel: K, wert: Felder[K]) {
    setFelder((alt) => ({ ...alt, [schluessel]: wert }));
    setFehler((alt) => ({ ...alt, [schluessel]: false }));
  }

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (laeuft) return;

    const neu: Partial<Record<keyof Felder, boolean>> = {};
    if (!felder.name.trim()) neu.name = true;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(felder.email.trim())) neu.email = true;
    const gaeste = Number(felder.gaeste);
    if (!Number.isInteger(gaeste) || gaeste < 1) neu.gaeste = true;

    setFehler(neu);
    if (Object.keys(neu).length > 0) return;

    setLaeuft(true);
    setStoerung(null);

    const ergebnis = await sendeVipAnfrage({
      name: felder.name,
      email: felder.email,
      telefon: felder.telefon,
      eventId: felder.eventId || null,
      gaeste,
      wunschdatum: felder.wunschdatum || null,
      paket: felder.paket || null,
      nachricht: felder.nachricht,
      falle,
      aufgebautUm: aufgebaut.current,
    });

    setLaeuft(false);

    if (ergebnis.ok) {
      setGesendet(true);
      return;
    }
    if (ergebnis.fehler === "email") setFehler({ email: true });
    else if (ergebnis.fehler === "gaeste") setFehler({ gaeste: true });
    else setStoerung(t("pflichtfeld"));
  }

  if (gesendet) {
    return (
      <div className={css.dank}>
        <span className="eyebrow">{t("eyebrow")}</span>
        <h2 className={css.dankTitel}>{t("gesendetTitel")}</h2>
        <p className={css.dankText}>{t("gesendetText")}</p>
      </div>
    );
  }

  return (
    <form className={css.form} onSubmit={absenden} noValidate>
      <div className={css.felder}>
        <div className={css.feld}>
          <label className={`${css.beschriftung} ${css.pflicht}`} htmlFor="vip-name">
            {t("name")}
          </label>
          <input
            id="vip-name"
            className={`${css.eingabe} ${fehler.name ? css.fehlerhaft : ""}`}
            value={felder.name}
            autoComplete="name"
            aria-invalid={fehler.name || undefined}
            onChange={(e) => setze("name", e.target.value)}
          />
          {fehler.name ? <span className={css.fehlertext}>{t("pflichtfeld")}</span> : null}
        </div>

        <div className={css.feld}>
          <label className={`${css.beschriftung} ${css.pflicht}`} htmlFor="vip-email">
            {t("email")}
          </label>
          <input
            id="vip-email"
            type="email"
            className={`${css.eingabe} ${fehler.email ? css.fehlerhaft : ""}`}
            value={felder.email}
            autoComplete="email"
            aria-invalid={fehler.email || undefined}
            onChange={(e) => setze("email", e.target.value)}
          />
          {fehler.email ? (
            <span className={css.fehlertext}>{t("emailUngueltig")}</span>
          ) : null}
        </div>

        <div className={css.feld}>
          <label className={css.beschriftung} htmlFor="vip-telefon">
            {t("telefon")}
          </label>
          <input
            id="vip-telefon"
            type="tel"
            className={css.eingabe}
            value={felder.telefon}
            autoComplete="tel"
            onChange={(e) => setze("telefon", e.target.value)}
          />
          <span className={css.hinweis}>Für kurze Rückfragen, schneller als Mail.</span>
        </div>

        <div className={css.feld}>
          <label className={`${css.beschriftung} ${css.pflicht}`} htmlFor="vip-gaeste">
            {t("gaeste")}
          </label>
          <input
            id="vip-gaeste"
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            className={`${css.eingabe} ${fehler.gaeste ? css.fehlerhaft : ""}`}
            value={felder.gaeste}
            aria-invalid={fehler.gaeste || undefined}
            onChange={(e) => setze("gaeste", e.target.value)}
          />
        </div>

        <div className={css.feld}>
          <label className={css.beschriftung} htmlFor="vip-event">
            {t("eventFeld")}
          </label>
          <select
            id="vip-event"
            className={css.auswahl}
            value={felder.eventId}
            onChange={(e) => setze("eventId", e.target.value)}
          >
            <option value="">{t("eventWaehlen")}</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.titel} · {e.wann}
              </option>
            ))}
          </select>
        </div>

        <div className={css.feld}>
          <label className={css.beschriftung} htmlFor="vip-datum">
            {t("wunschdatum")}
          </label>
          <input
            id="vip-datum"
            type="date"
            className={css.eingabe}
            value={felder.wunschdatum}
            onChange={(e) => setze("wunschdatum", e.target.value)}
          />
          <span className={css.hinweis}>Falls kein Event oben passt.</span>
        </div>

        <div className={`${css.feld} ${css.breit}`}>
          <label className={css.beschriftung} htmlFor="vip-paket">
            {t("paket")}
          </label>
          <select
            id="vip-paket"
            className={css.auswahl}
            value={felder.paket}
            onChange={(e) => setze("paket", e.target.value)}
          >
            <option value="">{t("paketOffen")}</option>
            {PAKETE.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className={`${css.feld} ${css.breit}`}>
          <label className={css.beschriftung} htmlFor="vip-nachricht">
            {t("nachricht")}
          </label>
          <textarea
            id="vip-nachricht"
            className={css.textfeld}
            value={felder.nachricht}
            placeholder={t("nachrichtPlatzhalter")}
            onChange={(e) => setze("nachricht", e.target.value)}
          />
        </div>
      </div>

      <div className={css.falle} aria-hidden="true">
        <label htmlFor="vip-firma">Firma (bitte frei lassen)</label>
        <input
          id="vip-firma"
          name="firma"
          tabIndex={-1}
          autoComplete="off"
          value={falle}
          onChange={(e) => setFalle(e.target.value)}
        />
      </div>

      {stoerung ? <p className={css.stoerung}>{stoerung}</p> : null}

      <div className={css.fuss}>
        <Knopf type="submit" stil="gold" groesse="gross" disabled={laeuft}>
          {laeuft ? "…" : t("senden")}
        </Knopf>
        <span className={css.hinweis}>
          Wir melden uns innerhalb von 24 Stunden. Deine Angaben verwenden wir
          nur für diese Anfrage.
        </span>
      </div>
    </form>
  );
}
