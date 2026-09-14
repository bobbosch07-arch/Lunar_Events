"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { StripeZahlung } from "./StripeZahlung";
import { Zaehler, zaehle } from "./Zaehler";
import { PaypalZahlung } from "./PaypalZahlung";
import { FastLaneAngebot } from "./FastLaneAngebot";
import type { FastLane } from "@/lib/typen";
import { preisText } from "@/lib/format";
import {
  reserviereBestellung,
  schliesseTestkaufAb,
  type ReservierungErgebnis,
} from "@/app/aktionen/bestellung";
import css from "./Checkout.module.css";

export type Posten = {
  phase_id: string;
  phase_name: string;
  menge: number;
  einzelpreis_cent: number;
  gebuehr_cent: number;
};

type Props = {
  eventId: string;
  eventSlug: string;
  eventTitel: string;
  eventWann: string;
  eventOrt: string;
  posten: Posten[];
  /** Solange keine Zahlungsanbieter eingerichtet sind, gibt es den Testweg. */
  testmodus: boolean;
  /** Stripe hat Schlüssel — dann wird echt gezahlt. */
  stripeAktiv: boolean;
  /** Gesetzt, wenn PayPal eingerichtet ist. */
  paypalClientId: string | null;
  /** Absolute Adresse, zu der Stripe nach der Zahlung zurückschickt. */
  rueckkehrBasis: string;
  /** Fast-Lane-Upgrade, falls das Event es anbietet und Plätze frei sind. */
  fastlane: FastLane | null;
};

type Formular = {
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
};

const LEER: Formular = { vorname: "", nachname: "", email: "", telefon: "" };

export function CheckoutFluss(props: Props) {
  const t = useTranslations("checkout");
  const locale = useLocale();
  const router = useRouter();

  const [schritt, setSchritt] = useState<1 | 2 | 3>(1);
  // Karte zuerst: der häufigere Weg, und Apple/Google Pay hängen daran.
  const [zahlweg, setZahlweg] = useState<"karte" | "paypal">(
    props.stripeAktiv ? "karte" : "paypal",
  );
  const [formular, setFormular] = useState<Formular>(LEER);
  const [fehler, setFehler] = useState<Partial<Record<keyof Formular, string>>>({});
  const [agb, setAgb] = useState(false);
  const [widerruf, setWiderruf] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [stoerung, setStoerung] = useState<string | null>(null);
  const [fastlane, setFastlane] = useState(false);
  const [angebotOffen, setAngebotOffen] = useState(false);
  const [bestellung, setBestellung] = useState<{
    id: string;
    nummer: string;
    bis: string;
  } | null>(null);

  const { zwischensumme, gebuehren, gesamt, anzahl } = useMemo(() => {
    let zwischensumme = 0;
    let gebuehren = 0;
    let anzahl = 0;
    for (const p of props.posten) {
      zwischensumme += p.einzelpreis_cent * p.menge;
      gebuehren += p.gebuehr_cent * p.menge;
      anzahl += p.menge;
    }
    return { zwischensumme, gebuehren, gesamt: zwischensumme + gebuehren, anzahl };
  }, [props.posten]);

  // Angeboten wird Fast Lane nur für die ganze Bestellung. Reichen die
  // freien Plätze nicht für alle Tickets, gibt es kein Angebot — halbe
  // Gruppen an der Schlange vorbei hilft niemandem.
  const angebot =
    props.fastlane && (props.fastlane.rest === null || props.fastlane.rest >= anzahl)
      ? props.fastlane
      : null;
  const fastlaneCent = fastlane && angebot ? angebot.preis_cent * anzahl : 0;
  const gesamtMitFastlane = gesamt + fastlaneCent;

  // Einmal beim Betreten der Kasse. Erst nach dem ersten Zeichnen, weil
  // showModal() ein fertiges Element braucht.
  const angebotGezeigt = useRef(false);
  useEffect(() => {
    if (angebot && !angebotGezeigt.current) {
      angebotGezeigt.current = true;
      setAngebotOffen(true);
    }
  }, [angebot]);

  function pruefe(): boolean {
    const neu: Partial<Record<keyof Formular, string>> = {};
    if (!formular.vorname.trim()) neu.vorname = t("schritt2");
    if (!formular.nachname.trim()) neu.nachname = t("schritt2");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(formular.email.trim())) {
      neu.email = t("schritt2");
    }
    setFehler(neu);

    if (Object.keys(neu).length > 0) {
      const erstes = (["vorname", "nachname", "email"] as const).find(
        (f) => f in neu,
      );
      if (erstes) document.getElementById(erstes)?.focus();
      return false;
    }
    return true;
  }

  async function zurZahlung() {
    if (!pruefe()) return;
    setLaeuft(true);
    setStoerung(null);

    const ergebnis: ReservierungErgebnis = await reserviereBestellung({
      eventId: props.eventId,
      auswahl: props.posten.map((p) => ({ phase_id: p.phase_id, menge: p.menge })),
      email: formular.email,
      vorname: formular.vorname,
      nachname: formular.nachname,
      telefon: formular.telefon,
      fastlane: fastlane && angebot ? anzahl : 0,
    });

    setLaeuft(false);

    if (!ergebnis.ok && ergebnis.fehler === "fastlane_aus") {
      // Die Tickets gibt es noch, nur die Fast-Lane-Plätze nicht mehr.
      // Den ganzen Kauf daran scheitern zu lassen wäre falsch.
      setFastlane(false);
      setStoerung(
        "Fast Lane ist gerade vergriffen. Wir haben sie herausgenommen — tippe noch einmal auf Weiter.",
      );
      return;
    }

    if (!ergebnis.ok) {
      // Wer zu spät kommt, muss es erfahren, bevor er Geld eingibt —
      // nicht erst danach.
      setStoerung(
        ergebnis.fehler === "nicht_genug"
          ? `„${ergebnis.phase}" ist inzwischen vergriffen. Verfügbar: ${ergebnis.rest ?? 0}.`
          : ergebnis.fehler === "vorbei" || ergebnis.fehler === "nicht_verfuegbar"
            ? "Dieses Event nimmt keine Bestellungen mehr an."
            : ergebnis.fehler === "phase_zu"
              ? "Diese Ticketphase ist nicht mehr buchbar."
              : t("fehler"),
      );
      return;
    }

    setBestellung({
      id: ergebnis.bestellung_id,
      nummer: ergebnis.nummer,
      bis: ergebnis.reserviert_bis,
    });
    zaehle("daten_erfasst", props.eventId);
    setSchritt(3);
  }

  async function kaufen() {
    if (!bestellung) return;
    setLaeuft(true);
    setStoerung(null);

    const ergebnis = await schliesseTestkaufAb(bestellung.id);
    setLaeuft(false);

    if (!ergebnis.ok) {
      setStoerung(t("fehler"));
      return;
    }
    router.push(`/checkout/bestaetigung?b=${bestellung.id}`);
  }

  const schritte = [t("schritt1"), t("schritt2"), t("schritt3"), t("schritt4")];

  return (
    <>
      <Zaehler art="kasse_begonnen" eventId={props.eventId} />
      {angebot ? (
        <FastLaneAngebot
          offen={angebotOffen}
          angebot={angebot}
          anzahl={anzahl}
          gewaehlt={fastlane}
          uebernehmen={(wahl) => {
            setFastlane(wahl);
            setAngebotOffen(false);
          }}
          schliessen={() => setAngebotOffen(false)}
        />
      ) : null}
      <ol className={css.schritte}>
        {schritte.map((name, i) => {
          const nr = i + 1;
          const klasse =
            nr === schritt ? css.schrittAktiv : nr < schritt ? css.schrittFertig : "";
          return (
            <li key={name} className={`${css.schritt} ${klasse}`}>
              <span className={css.schrittNr}>{String(nr).padStart(2, "0")}</span>
              <span>{name}</span>
            </li>
          );
        })}
      </ol>

      <div className={css.spalten}>
        <div className={css.haupt}>
        {schritt === 1 ? (
          <>
            <h1 className={css.titel}>{t("schritt1")}</h1>
            <p className={css.hinweis}>
              {anzahl} {anzahl === 1 ? "Ticket" : "Tickets"} für {props.eventTitel}.
            </p>
            {angebot ? (
              <div className={css.zustimmungen}>
                <label className={css.zustimmung}>
                  <input
                    type="checkbox"
                    checked={fastlane}
                    onChange={(e) => setFastlane(e.target.checked)}
                  />
                  <span>
                    <strong>Fast Lane</strong> — nicht anstehen, eigene Spur am
                    Einlass. + {preisText(angebot.preis_cent * anzahl, locale)}{" "}
                    <button
                      type="button"
                      className={css.zfAendern}
                      onClick={() => setAngebotOffen(true)}
                    >
                      Mehr erfahren
                    </button>
                  </span>
                </label>
              </div>
            ) : null}
            <div className={css.knoepfe}>
              <Knopf onClick={() => setSchritt(2)} groesse="gross">
                {t("weiter")}
              </Knopf>
              <Knopf href={`/events/${props.eventSlug}`} stil="linie">
                {t("zurueck")}
              </Knopf>
            </div>
          </>
        ) : null}

        {schritt === 2 ? (
          <>
            <h1 className={css.titel}>{t("deineDaten")}</h1>

            <div className={css.felder}>
              <Feld
                name="vorname"
                beschriftung={t("vorname")}
                wert={formular.vorname}
                fehler={fehler.vorname}
                autoComplete="given-name"
                aendern={(v) => setFormular((f) => ({ ...f, vorname: v }))}
              />
              <Feld
                name="nachname"
                beschriftung={t("nachname")}
                wert={formular.nachname}
                fehler={fehler.nachname}
                autoComplete="family-name"
                aendern={(v) => setFormular((f) => ({ ...f, nachname: v }))}
              />
              <div className={css.feldBreit}>
                <Feld
                  name="email"
                  typ="email"
                  beschriftung={t("email")}
                  wert={formular.email}
                  fehler={fehler.email}
                  hinweis={t("emailHinweis")}
                  autoComplete="email"
                  aendern={(v) => setFormular((f) => ({ ...f, email: v }))}
                />
              </div>
              <div className={css.feldBreit}>
                <Feld
                  name="telefon"
                  typ="tel"
                  beschriftung={t("telefon")}
                  wert={formular.telefon}
                  autoComplete="tel"
                  aendern={(v) => setFormular((f) => ({ ...f, telefon: v }))}
                />
              </div>
            </div>

            {stoerung ? <p className={css.stoerung}>{stoerung}</p> : null}

            <div className={css.knoepfe}>
              <Knopf onClick={zurZahlung} disabled={laeuft} groesse="gross">
                {laeuft ? "…" : t("weiter")}
              </Knopf>
              <Knopf onClick={() => setSchritt(1)} stil="linie" disabled={laeuft}>
                {t("zurueck")}
              </Knopf>
            </div>
          </>
        ) : null}

        {schritt === 3 && bestellung ? (
          <>
            <h1 className={css.titel}>{t("zahlungsart")}</h1>
            <Uhr bis={bestellung.bis} />

            {/* Die Zustimmungen stehen vor dem Zahlformular: erst
                zustimmen, dann zahlen — nicht andersherum. */}
            <div className={css.zustimmungen}>
              <label className={css.zustimmung}>
                <input
                  type="checkbox"
                  checked={agb}
                  onChange={(e) => setAgb(e.target.checked)}
                />
                <span>
                  Ich habe die <Link href="/agb">AGB</Link> und die{" "}
                  <Link href="/datenschutz">Datenschutzerklärung</Link> gelesen.
                </span>
              </label>
              <label className={css.zustimmung}>
                <input
                  type="checkbox"
                  checked={widerruf}
                  onChange={(e) => setWiderruf(e.target.checked)}
                />
                <span>{t("widerrufText")}</span>
              </label>
            </div>

            {/* Die Auswahl erscheint nur, wenn es wirklich etwas zu wählen
                gibt — bei einem einzigen Weg wäre sie ein leerer Klick. */}
            {props.stripeAktiv && props.paypalClientId ? (
              <div className={css.zahlarten}>
                <label
                  className={`${css.zahlart} ${zahlweg === "karte" ? css.zahlartGewaehlt : ""}`}
                >
                  <input
                    type="radio"
                    name="zahlweg"
                    checked={zahlweg === "karte"}
                    onChange={() => setZahlweg("karte")}
                  />
                  <span className={css.zahlartName}>{t("karte")}</span>
                  <span className={css.zahlartNotiz}>Apple Pay · Google Pay · SEPA</span>
                </label>
                <label
                  className={`${css.zahlart} ${zahlweg === "paypal" ? css.zahlartGewaehlt : ""}`}
                >
                  <input
                    type="radio"
                    name="zahlweg"
                    checked={zahlweg === "paypal"}
                    onChange={() => setZahlweg("paypal")}
                  />
                  <span className={css.zahlartName}>{t("paypal")}</span>
                </label>
              </div>
            ) : null}

            {props.stripeAktiv && zahlweg === "karte" ? (
              <StripeZahlung
                bestellungId={bestellung.id}
                rueckkehr={`${props.rueckkehrBasis}/checkout/bestaetigung?b=${bestellung.id}`}
                freigegeben={agb && widerruf}
              />
            ) : props.paypalClientId ? (
              <PaypalZahlung
                bestellungId={bestellung.id}
                clientId={props.paypalClientId}
                freigegeben={agb && widerruf}
              />
            ) : (
              <>
                <p className={css.testhinweis}>
                  Es ist noch kein Zahlungsanbieter eingerichtet. Der Kauf lässt
                  sich hier ohne Zahlung abschließen, damit der Ablauf geprüft
                  werden kann. Sobald Stripe oder PayPal Schlüssel haben,
                  verschwindet dieser Weg von selbst.
                </p>
                {stoerung ? <p className={css.stoerung}>{stoerung}</p> : null}
                <div className={css.knoepfe}>
                  <Knopf
                    onClick={kaufen}
                    disabled={!agb || !widerruf || laeuft || !props.testmodus}
                    groesse="gross"
                  >
                    {laeuft ? "…" : t("jetztKaufen")}
                  </Knopf>
                </div>
              </>
            )}

            <p className={css.hinweis}>
              {t("bestellnummer")}: <strong>{bestellung.nummer}</strong>
            </p>
          </>
        ) : null}
      </div>

        <aside className={css.zusammenfassung}>
        <div className={css.zfEvent}>
          <span className={css.zfTitel}>{props.eventTitel}</span>
          <span className={css.zfDetail}>{props.eventWann}</span>
          <span className={css.zfDetail}>{props.eventOrt}</span>
        </div>

        <div className={css.zfPosten}>
          {props.posten.map((p) => (
            <div key={p.phase_id} className={css.zfZeile}>
              <span className={css.zfName}>
                {p.phase_name} <span className={css.zfMenge}>× {p.menge}</span>
              </span>
              <span className={css.zfWert}>
                {preisText(p.einzelpreis_cent * p.menge, locale)}
              </span>
            </div>
          ))}
        </div>

        <div className={css.zfTrenner} />

        <div className={css.zfPosten}>
          <div className={css.zfZeile}>
            <span className={css.zfName}>{t("zwischensumme")}</span>
            <span className={css.zfWert}>{preisText(zwischensumme, locale)}</span>
          </div>
          {gebuehren > 0 ? (
            <div className={css.zfZeile}>
              <span className={css.zfName}>{t("gebuehr")}</span>
              <span className={css.zfWert}>{preisText(gebuehren, locale)}</span>
            </div>
          ) : null}
          {fastlaneCent > 0 ? (
            <div className={css.zfZeile}>
              <span className={css.zfName}>
                Fast Lane <span className={css.zfMenge}>× {anzahl}</span>
              </span>
              <span className={css.zfWert}>{preisText(fastlaneCent, locale)}</span>
            </div>
          ) : null}
        </div>

        <div className={css.zfTrenner} />

        <div className={css.zfSumme}>
          <span className={css.zfSummeLabel}>{t("gesamt")}</span>
          <span className={css.zfSummeWert}>{preisText(gesamtMitFastlane, locale)}</span>
        </div>

        {schritt === 1 ? (
          <Link href={`/events/${props.eventSlug}`} className={css.zfAendern}>
            {t("zurueck")}
          </Link>
        ) : null}
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Feld({
  name,
  beschriftung,
  wert,
  aendern,
  typ = "text",
  fehler,
  hinweis,
  autoComplete,
}: {
  name: string;
  beschriftung: string;
  wert: string;
  aendern: (v: string) => void;
  typ?: string;
  fehler?: string;
  hinweis?: string;
  autoComplete?: string;
}) {
  return (
    <div className={css.feld}>
      <label className={css.beschriftung} htmlFor={name}>
        {beschriftung}
      </label>
      <input
        id={name}
        name={name}
        type={typ}
        // E-Mail-Adressen und Namen unterkringelt die Rechtschreibprüfung
        // sinnlos rot.
        spellCheck={false}
        value={wert}
        autoComplete={autoComplete}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={fehler ? `${name}-fehler` : hinweis ? `${name}-hinweis` : undefined}
        className={`${css.eingabe} ${fehler ? css.eingabeFehler : ""}`}
        onChange={(e) => aendern(e.target.value)}
      />
      {fehler ? (
        <span id={`${name}-fehler`} className={css.fehlertext}>
          Bitte ausfüllen
        </span>
      ) : hinweis ? (
        <span id={`${name}-hinweis`} className={css.hinweis}>
          {hinweis}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Zeigt, wie lange die Tickets noch gehalten werden. Kein Druckmittel —
 * die Frist ist echt, sie steht als reserviert_bis in der Datenbank und
 * gibt das Kontingent danach wirklich frei.
 */
function Uhr({ bis }: { bis: string }) {
  const t = useTranslations("checkout");
  const [rest, setRest] = useState(() =>
    Math.max(0, Math.floor((new Date(bis).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setRest(Math.max(0, Math.floor((new Date(bis).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [bis]);

  if (rest === 0) return <p className={css.stoerung}>{t("abgelaufen")}</p>;

  const minuten = String(Math.floor(rest / 60)).padStart(2, "0");
  const sekunden = String(rest % 60).padStart(2, "0");

  return (
    <p className={`${css.uhr} ${rest < 120 ? css.uhrKnapp : ""}`}>
      {t("reserviertNoch", { minuten, sekunden })}
    </p>
  );
}
