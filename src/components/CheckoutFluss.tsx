"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { StripeZahlung, ZUSTIMMUNG_FEHLT, zeigeFehlendeZustimmung } from "./StripeZahlung";
import { Zaehler, zaehle } from "./Zaehler";
import { PaypalZahlung } from "./PaypalZahlung";
import { FastLaneAngebot } from "./FastLaneAngebot";
import { Mengenwahl } from "./Mengenwahl";
import { waehleVorkasse } from "@/app/aktionen/vorkasse";
import {
  GARDEROBE_JE_TICKET,
  type CodeAblehnung,
  type CodeVorschau,
  type FastLane,
  type Flagge,
  type Garderobe,
} from "@/lib/typen";
import { preisText } from "@/lib/format";
import { steuerhinweis } from "@/lib/steuer";
import { merkeCode, normalisiereCode, vergissCode } from "@/lib/rabatt";
import {
  pruefeRabattcode,
  reserviereBestellung,
  schliesseKostenlosAb,
  schliesseTestkaufAb,
  uebernimmAngebot,
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
  /** Garderobe je Stück, falls das Event sie online anbietet (0027). */
  garderobe: Garderobe | null;
  /** Woran der Einlass scheitern kann (18.09.2026) — mit eigenem Häkchen. */
  flaggen: Flagge[];
  /** Bankverbindung hinterlegt und das Event weit genug entfernt. */
  vorkasseMoeglich: boolean;
  /** Code aus dem Link, auf dem Server schon geprüft. */
  startCode: { text: string; vorschau: CodeVorschau } | null;
  /** Kürzel eines Promoters aus dem Link — nur für die Zuordnung. */
  promo: string | null;
  /** Presale über eine persönliche Einladung: nur mit dieser Adresse. */
  einladung: { token: string; email: string } | null;
  /** Der Code, der den Presale öffnet — er darf nicht herausfliegen. */
  presaleCode: string | null;
  /**
   * Kauf über ein Warteliste-Angebot: Die Tickets sind schon reserviert,
   * Adresse und Auswahl stehen fest. Kein Code, keine Fast Lane — das
   * Angebot ist genau das, was für diese Person zurückgelegt wurde.
   */
  warteliste: { token: string; email: string; vorname: string | null; bis: string } | null;
};

type GueltigerCode = Extract<CodeVorschau, { ergebnis: "ok" }>;

type Formular = {
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
};

const LEER: Formular = { vorname: "", nachname: "", email: "", telefon: "" };

export function CheckoutFluss(props: Props) {
  const t = useTranslations("checkout");
  const tg = useTranslations("garderobe");
  const te = useTranslations("event");
  const locale = useLocale();
  const router = useRouter();

  const [schritt, setSchritt] = useState<1 | 2 | 3>(1);
  // Karte zuerst: der häufigere Weg, und Apple/Google Pay hängen daran.
  const [zahlweg, setZahlweg] = useState<"karte" | "paypal" | "vorkasse">(
    props.stripeAktiv
      ? "karte"
      : props.paypalClientId
        ? "paypal"
        : props.vorkasseMoeglich
          ? "vorkasse"
          : "paypal",
  );
  const [formular, setFormular] = useState<Formular>(
    props.warteliste
      ? { ...LEER, email: props.warteliste.email, vorname: props.warteliste.vorname ?? "" }
      : props.einladung
        ? { ...LEER, email: props.einladung.email }
        : LEER,
  );
  const [fehler, setFehler] = useState<Partial<Record<keyof Formular, string>>>({});
  const [agb, setAgb] = useState(false);
  const [widerruf, setWiderruf] = useState(false);
  const [flaggenOk, setFlaggenOk] = useState(false);
  // Alle Bezahlwege hängen an denselben Zustimmungen.
  const zugestimmt = agb && widerruf && (props.flaggen.length === 0 || flaggenOk);
  const [laeuft, setLaeuft] = useState(false);
  const [stoerung, setStoerung] = useState<string | null>(null);
  const [fastlane, setFastlane] = useState(false);
  // Garderobe: Stückzahl, beginnt bei 0 — ein kostenpflichtiges Extra wählt
  // der Gast selbst (§ 312a Abs. 3 BGB), wie Fast Lane.
  const [garderobe, setGarderobe] = useState(0);
  const [angebotOffen, setAngebotOffen] = useState(false);
  const [zfOffen, setZfOffen] = useState(false);
  const [bestellung, setBestellung] = useState<{
    id: string;
    nummer: string;
    bis: string;
    /** Verbindlich aus der Datenbank, sobald reserviert ist. */
    codeRabattCent: number;
  } | null>(null);

  // Rabattcode. Ein gültiger Code aus dem Link ist sofort eingelöst; ein
  // ungültiger klappt das Feld auf und sagt, warum.
  const startGueltig =
    props.startCode?.vorschau.ergebnis === "ok" ? props.startCode.vorschau : null;
  const [code, setCode] = useState<GueltigerCode | null>(startGueltig);
  const [codeOffen, setCodeOffen] = useState(Boolean(props.startCode && !startGueltig));
  const [codeEingabe, setCodeEingabe] = useState(props.startCode?.text ?? "");
  const [codeFehler, setCodeFehler] = useState<string | null>(() =>
    props.startCode && props.startCode.vorschau.ergebnis !== "ok"
      ? codeGrund(props.startCode.vorschau)
      : null,
  );
  const [codePrueft, setCodePrueft] = useState(false);
  const codeFeld = useRef<HTMLInputElement>(null);
  // Nur nach einem Klick auf "Rabattcode?" fokussieren — nicht, wenn das Feld
  // wegen eines ungültigen Codes aus dem Link schon offen ist: Das öffnete
  // auf dem Handy ungefragt die Tastatur.
  const codeFokus = useRef(false);
  useEffect(() => {
    if (codeOffen && codeFokus.current) {
      codeFokus.current = false;
      codeFeld.current?.focus();
    }
  }, [codeOffen]);

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
    !props.warteliste &&
    props.fastlane &&
    (props.fastlane.rest === null || props.fastlane.rest >= anzahl)
      ? props.fastlane
      : null;
  const fastlaneCent = fastlane && angebot ? angebot.preis_cent * anzahl : 0;
  // Die Warteliste hält genau das zurück, was angeboten wurde — Garderobe
  // lässt sich danach auf der Ticketseite nachbuchen.
  const garderobeAngebot = props.warteliste ? null : props.garderobe;
  const garderobeMax = garderobeAngebot
    ? Math.min(GARDEROBE_JE_TICKET * anzahl, garderobeAngebot.rest ?? Infinity)
    : 0;
  const garderobeCent = garderobeAngebot ? garderobeAngebot.preis_cent * garderobe : 0;
  const gesamtMitZusaetzen = gesamt + fastlaneCent + garderobeCent;
  // Vorkasse-Rabatt = die Servicegebühren. Ein Nachlass für diese
  // Zahlungsart, kein Aufschlag auf die anderen (§ 270a BGB) — deshalb
  // steht er als eigene Minuszeile da und nicht als "ohne Gebühr".
  const rabattCent = zahlweg === "vorkasse" && schritt === 3 ? gebuehren : 0;
  // Vor der Reservierung die Vorschau, danach der Betrag, den die Datenbank
  // tatsächlich abzieht.
  const codeCent = bestellung ? bestellung.codeRabattCent : (code?.rabatt_cent ?? 0);
  const gesamtEndCent = Math.max(0, gesamtMitZusaetzen - codeCent - rabattCent);
  // Kostet die Bestellung dank Code nichts, gibt es nichts zu bezahlen —
  // weder Karte noch Überweisung.
  const kostenlos = codeCent > 0 && gesamtMitZusaetzen - codeCent <= 0;
  const wege = [
    props.stripeAktiv ? "karte" : null,
    props.paypalClientId ? "paypal" : null,
    props.vorkasseMoeglich ? "vorkasse" : null,
  ].filter(Boolean);

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

  /** Warum ein Code nicht gilt, in einem Satz. */
  function codeGrund(v: CodeAblehnung): string {
    if (v.ergebnis === "noch_nicht") {
      return t("code.noch_nicht", {
        datum: new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Berlin",
        }).format(new Date(v.ab)),
      });
    }
    return t(`code.${v.ergebnis}`);
  }

  const auswahlFuerDb = () =>
    props.posten.map((p) => ({ phase_id: p.phase_id, menge: p.menge }));

  async function einloesen(e: FormEvent) {
    e.preventDefault();
    const text = normalisiereCode(codeEingabe);
    if (!text) return;
    setCodePrueft(true);
    setCodeFehler(null);
    const vorschau = await pruefeRabattcode({
      eventId: props.eventId,
      code: text,
      auswahl: auswahlFuerDb(),
      fastlane: fastlane && angebot ? anzahl : 0,
    });
    setCodePrueft(false);
    if (vorschau.ergebnis === "ok") {
      setCode(vorschau);
      setCodeOffen(false);
      merkeCode(vorschau.code);
    } else {
      setCodeFehler(codeGrund(vorschau));
    }
  }

  function entferneCode() {
    setCode(null);
    setCodeEingabe("");
    setCodeFehler(null);
    vergissCode();
    // Sonst käme er beim Neuladen der Seite aus der Adresse zurück.
    const adresse = new URL(window.location.href);
    if (adresse.searchParams.has("code")) {
      adresse.searchParams.delete("code");
      window.history.replaceState(window.history.state, "", adresse);
    }
  }

  /**
   * Fast Lane ändert den Rabatt selbst nicht — er wirkt nur auf Tickets.
   * Nachgefragt wird trotzdem: Bliebe ohne Fast Lane ein Restbetrag unter
   * 50 Cent, erlässt die Datenbank ihn; mit Fast Lane nicht mehr.
   */
  function waehleFastlane(wahl: boolean) {
    setFastlane(wahl);
    if (!code) return;
    void pruefeRabattcode({
      eventId: props.eventId,
      code: code.code,
      auswahl: auswahlFuerDb(),
      fastlane: wahl && angebot ? anzahl : 0,
    }).then((vorschau) => {
      if (vorschau.ergebnis === "ok") setCode(vorschau);
    });
  }

  async function zurZahlung() {
    if (!pruefe()) return;
    setLaeuft(true);
    setStoerung(null);

    const ergebnis: ReservierungErgebnis = props.warteliste
      ? await uebernimmAngebot({
          token: props.warteliste.token,
          vorname: formular.vorname,
          nachname: formular.nachname,
          telefon: formular.telefon,
        })
      : await reserviereBestellung({
          eventId: props.eventId,
          auswahl: auswahlFuerDb(),
          email: formular.email,
          vorname: formular.vorname,
          nachname: formular.nachname,
          telefon: formular.telefon,
          fastlane: fastlane && angebot ? anzahl : 0,
          code: code?.code ?? null,
          promo: props.promo,
          einladung: props.einladung?.token ?? null,
          garderobe: garderobeAngebot ? garderobe : 0,
        });

    setLaeuft(false);

    if (!ergebnis.ok && ergebnis.fehler === "angebot_vorbei") {
      setStoerung(t("wartelisteVorbei"));
      return;
    }

    if (
      !ergebnis.ok &&
      ["presale_zugang", "presale_adresse", "verkauf_noch_nicht"].includes(ergebnis.fehler)
    ) {
      setStoerung(
        ergebnis.fehler === "presale_adresse"
          ? t("presaleAndereAdresse")
          : ergebnis.fehler === "verkauf_noch_nicht"
            ? t("verkaufNochNicht")
            : t("presaleZugangFehlt"),
      );
      return;
    }

    if (!ergebnis.ok && ergebnis.fehler === "code") {
      // Wie bei Fast Lane: Am Code soll der Kauf nicht scheitern. Er fliegt
      // heraus, und der Gast sieht den neuen Betrag, bevor er weitergeht.
      const grund = codeGrund(
        ergebnis.code && ergebnis.code !== "noch_nicht"
          ? { ergebnis: ergebnis.code }
          : { ergebnis: "unbekannt" },
      );
      entferneCode();
      setStoerung(t("code.herausgenommen", { grund }));
      return;
    }

    if (!ergebnis.ok && ergebnis.fehler === "fastlane_aus") {
      // Die Tickets gibt es noch, nur die Fast-Lane-Plätze nicht mehr.
      // Den ganzen Kauf daran scheitern zu lassen wäre falsch.
      waehleFastlane(false);
      setStoerung(
        "Fast Lane ist gerade vergriffen. Wir haben sie herausgenommen, tipp einfach noch einmal auf Weiter.",
      );
      return;
    }

    if (!ergebnis.ok && ergebnis.fehler === "garderobe_aus") {
      // Wie Fast Lane: Am Zusatz soll der Kauf nicht scheitern.
      setGarderobe(0);
      setStoerung(tg("vergriffen"));
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
              : ergebnis.fehler === "zu_viele"
                ? "Gerade laufen zu viele offene Reservierungen für diese Adresse oder diesen Anschluss. Bitte versuch es in ein paar Minuten noch einmal."
                : ergebnis.fehler === "email"
                  ? "Bitte prüf deine E-Mail-Adresse."
                  : ergebnis.fehler === "menge"
                    ? "Pro Bestellung gehen höchstens 20 Tickets."
                    : "Das hat nicht geklappt. Lade die Seite neu und versuch es noch einmal.",
      );
      return;
    }

    setBestellung({
      id: ergebnis.bestellung_id,
      nummer: ergebnis.nummer,
      bis: ergebnis.reserviert_bis,
      codeRabattCent: ergebnis.code_rabatt_cent,
    });
    // Zwischen Vorschau und Reservierung kann die Obergrenze erreicht
    // worden sein — dann gilt der Code für weniger Tickets als angezeigt.
    if (code && ergebnis.code_tickets !== code.tickets) {
      setCode({ ...code, tickets: ergebnis.code_tickets, rabatt_cent: ergebnis.code_rabatt_cent });
    }
    zaehle("daten_erfasst", props.eventId);
    setSchritt(3);
  }

  async function kostenlosBestellen() {
    if (!bestellung) return;
    setLaeuft(true);
    setStoerung(null);
    const ergebnis = await schliesseKostenlosAb(bestellung.id);
    if (!ergebnis.ok) {
      setLaeuft(false);
      setStoerung(ergebnis.fehler === "abgelaufen" ? t("abgelaufen") : t("fehler"));
      return;
    }
    vergissCode();
    router.push(`/checkout/bestaetigung?b=${bestellung.id}`);
  }

  async function perUeberweisung() {
    if (!bestellung) return;
    setLaeuft(true);
    setStoerung(null);
    const ergebnis = await waehleVorkasse(bestellung.id);
    if (!ergebnis.ok) {
      setLaeuft(false);
      setStoerung(
        ergebnis.fehler === "zu_kurzfristig"
          ? "Für dieses Event ist es für eine Überweisung zu knapp. Bitte wähle eine andere Zahlungsart."
          : ergebnis.fehler === "abgelaufen"
            ? "Die Reservierung ist abgelaufen. Bitte wähle die Tickets noch einmal."
            : t("fehler"),
      );
      return;
    }
    router.push(`/checkout/bestaetigung?b=${bestellung.id}`);
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
            waehleFastlane(wahl);
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
            <li
              key={name}
              className={`${css.schritt} ${klasse}`}
              aria-current={nr === schritt ? "step" : undefined}
            >
              <span className={css.schrittNr}>{String(nr).padStart(2, "0")}</span>
              <span className={css.schrittName}>{name}</span>
            </li>
          );
        })}
      </ol>

      <div className={css.spalten}>
        <div className={css.haupt}>
        {schritt === 1 ? (
          <>
            <h1 className={css.titel}>{t("schritt1")}</h1>
            {props.flaggen.map((fl) => (
              <p key={fl.art} className={css.flagge}>
                <span className={css.flaggeKurz}>{te("flaggeAlter", { jahre: fl.jahre })}</span>
                <span>{t("flaggeHinweis", { jahre: fl.jahre })}</span>
              </p>
            ))}
            <p className={css.hinweis}>
              {anzahl} {anzahl === 1 ? "Ticket" : "Tickets"} für {props.eventTitel}.
            </p>
            {props.warteliste?.bis ? (
              <p className={css.codeAktiv}>
                <span className={css.codeHaken} aria-hidden="true">
                  ✓
                </span>
                <span className={css.codeText}>
                  {t("wartelisteHinweis", { zeit: fristText(props.warteliste.bis, locale) })}
                </span>
              </p>
            ) : null}
            {angebot ? (
              <div id="zustimmungen" className={css.zustimmungen}>
                <label className={css.zustimmung}>
                  <input
                    type="checkbox"
                    checked={fastlane}
                    onChange={(e) => waehleFastlane(e.target.checked)}
                  />
                  <span>
                    <strong>Fast Lane</strong>: eigene Spur am Einlass, kein
                    Anstehen. + {preisText(angebot.preis_cent * anzahl, locale)}{" "}
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

            {garderobeAngebot && garderobeMax > 0 ? (
              <div className={css.zusatz}>
                <div className={css.zusatzText}>
                  <strong>{tg("titel")}</strong>
                  <span>
                    {tg("kasseText", { preis: preisText(garderobeAngebot.preis_cent, locale) })}
                  </span>
                </div>
                <Mengenwahl
                  wert={garderobe}
                  max={garderobeMax}
                  aendern={setGarderobe}
                  name={tg("name")}
                />
              </div>
            ) : null}

            {/* Bewusst zurückhaltend: ein Verweis statt eines offenen Feldes.
                Ein großes Codefeld schickt Gäste auf die Suche nach Codes
                (Briefing: keine Rabattschlacht). Wer einen hat, findet ihn. */}
            {props.warteliste ? null : code ? (
              <div className={css.codeAktiv}>
                <span className={css.codeHaken} aria-hidden="true">
                  ✓
                </span>
                <span className={css.codeText}>
                  <span>
                    <strong>{code.code}</strong> ·{" "}
                    {code.rabatt_cent === 0 && code.oeffnet_presale
                      ? t("presaleZugang")
                      : `− ${preisText(code.rabatt_cent, locale)}`}
                  </span>
                  {code.tickets < code.tickets_gesamt ? (
                    <span className={css.codeZusatz}>
                      {t("code.teilweise", {
                        anzahl: code.tickets,
                        gesamt: code.tickets_gesamt,
                      })}
                    </span>
                  ) : null}
                </span>
                {/* Öffnet dieser Code den Presale, wäre ohne ihn kein Kauf
                    möglich — dann gibt es nichts zu entfernen. */}
                {code.code === props.presaleCode && !props.einladung ? null : (
                  <button type="button" className={css.zfAendern} onClick={entferneCode}>
                    {t("code.entfernen")}
                  </button>
                )}
              </div>
            ) : codeOffen ? (
              <form className={css.codeForm} onSubmit={einloesen} noValidate>
                <label className={css.beschriftung} htmlFor="rabattcode">
                  {t("code.feld")}
                </label>
                <div className={css.codeReihe}>
                  <input
                    id="rabattcode"
                    name="rabattcode"
                    className={`${css.eingabe} ${codeFehler ? css.eingabeFehler : ""}`}
                    value={codeEingabe}
                    onChange={(e) => {
                      setCodeEingabe(e.target.value);
                      // Die alte Meldung gilt für den alten Code.
                      setCodeFehler(null);
                    }}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    enterKeyHint="done"
                    aria-invalid={codeFehler ? true : undefined}
                    aria-describedby={codeFehler ? "rabattcode-fehler" : undefined}
                    ref={codeFeld}
                  />
                  <Knopf type="submit" stil="linie" disabled={codePrueft || !codeEingabe.trim()}>
                    {codePrueft ? "…" : t("code.einloesen")}
                  </Knopf>
                </div>
                {codeFehler ? (
                  <span id="rabattcode-fehler" className={css.fehlertext} role="alert">
                    {codeFehler}
                  </span>
                ) : null}
              </form>
            ) : (
              <button
                type="button"
                className={`${css.zfAendern} ${css.codeFrage}`}
                onClick={() => {
                  codeFokus.current = true;
                  setCodeOffen(true);
                }}
              >
                {t("code.frage")}
              </button>
            )}

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
                  hinweis={
                    props.warteliste
                      ? t("wartelisteAdresse")
                      : props.einladung
                        ? t("einladungAdresse")
                        : t("emailHinweis")
                  }
                  nurLesen={Boolean(props.einladung || props.warteliste)}
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

            {/* Pflicht für spätere Einladungen per Mail (§ 7 Abs. 3 UWG): Der
                Hinweis muss beim Erheben der Adresse stehen. Der Server
                vermerkt ihn an der Bestellung (werbehinweis) — wer ihn hier
                entfernt, muss auch das entfernen. */}
            <p className={css.hinweis}>{t("werbehinweis")}</p>

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
              {props.flaggen.map((fl) => (
                <label key={fl.art} className={css.zustimmung}>
                  <input
                    type="checkbox"
                    checked={flaggenOk}
                    onChange={(e) => setFlaggenOk(e.target.checked)}
                  />
                  <span>{t("flaggeZustimmung", { jahre: fl.jahre })}</span>
                </label>
              ))}
            </div>

            {kostenlos ? (
              <>
                <p className={css.hinweis}>{t("code.kostenlosText")}</p>
                {stoerung ? <p className={css.stoerung}>{stoerung}</p> : null}
                <div className={css.knoepfe}>
                  <Knopf
                    onClick={() => {
                      if (!zugestimmt) {
                        setStoerung(ZUSTIMMUNG_FEHLT);
                        zeigeFehlendeZustimmung();
                        return;
                      }
                      kostenlosBestellen();
                    }}
                    disabled={laeuft}
                    groesse="gross"
                  >
                    {laeuft ? "…" : t("code.kostenlosKnopf")}
                  </Knopf>
                </div>
              </>
            ) : (
              <>
                {/* Die Auswahl erscheint nur, wenn es wirklich etwas zu wählen
                    gibt — bei einem einzigen Weg wäre sie ein leerer Klick. */}
                {wege.length > 1 ? (
                  <div className={css.zahlarten}>
                    {props.stripeAktiv ? (
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
                    ) : null}
                    {props.paypalClientId ? (
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
                    ) : null}
                    {props.vorkasseMoeglich ? (
                      <label
                        className={`${css.zahlart} ${zahlweg === "vorkasse" ? css.zahlartGewaehlt : ""}`}
                      >
                        <input
                          type="radio"
                          name="zahlweg"
                          checked={zahlweg === "vorkasse"}
                          onChange={() => setZahlweg("vorkasse")}
                        />
                        <span className={css.zahlartName}>Überweisung (Vorkasse)</span>
                        <span className={css.zahlartNotiz}>
                          {gebuehren > 0
                            ? `${preisText(gebuehren, locale)} Rabatt · Tickets nach Zahlungseingang`
                            : "Tickets nach Zahlungseingang"}
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                {zahlweg === "vorkasse" && props.vorkasseMoeglich ? (
                  <>
                    <p className={css.hinweis}>
                      Du bekommst gleich die Bankverbindung. Deine Plätze bleiben
                      einige Tage reserviert; die Tickets erscheinen, sobald die
                      Überweisung angekommen ist.
                      {gebuehren > 0
                        ? ` Für die Überweisung ziehen wir ${preisText(gebuehren, locale)} ab.`
                        : ""}
                    </p>
                    {stoerung ? <p className={css.stoerung}>{stoerung}</p> : null}
                    <div className={css.knoepfe}>
                      <Knopf
                        onClick={perUeberweisung}
                        disabled={!zugestimmt || laeuft}
                        groesse="gross"
                      >
                        {laeuft ? "…" : "Verbindlich per Überweisung bestellen"}
                      </Knopf>
                    </div>
                  </>
                ) : props.stripeAktiv && zahlweg === "karte" ? (
                  <StripeZahlung
                    bestellungId={bestellung.id}
                    rueckkehr={`${props.rueckkehrBasis}/checkout/bestaetigung?b=${bestellung.id}`}
                    freigegeben={zugestimmt}
                  />
                ) : props.paypalClientId ? (
                  <PaypalZahlung
                    bestellungId={bestellung.id}
                    clientId={props.paypalClientId}
                    freigegeben={zugestimmt}
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
                        disabled={!zugestimmt || laeuft || !props.testmodus}
                        groesse="gross"
                      >
                        {laeuft ? "…" : t("jetztKaufen")}
                      </Knopf>
                    </div>
                  </>
                )}
              </>
            )}

            <p className={css.hinweis}>
              {t("bestellnummer")}: <strong>{bestellung.nummer}</strong>
            </p>
          </>
        ) : null}
      </div>

        <aside className={css.zusammenfassung} data-offen={zfOffen ? "" : undefined}>
          {/* Nur auf dem Handy zu sehen: Dort steht die Zusammenfassung über
              dem Formular und ist eingeklappt, damit das Formular im ersten
              Bildschirm beginnt. Die Summe bleibt auch eingeklappt stehen. */}
          <button
            type="button"
            className={css.zfKnopf}
            aria-expanded={zfOffen}
            aria-controls="bestellung-details"
            onClick={() => setZfOffen((o) => !o)}
          >
            <span className={css.zfKnopfName}>
              {t("uebersicht")}
              <svg
                className={css.zfPfeil}
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
            <span className={css.zfKnopfSumme}>{preisText(gesamtEndCent, locale)}</span>
          </button>

          <div id="bestellung-details" className={css.zfInhalt}>
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
              {garderobeCent > 0 ? (
                <div className={css.zfZeile}>
                  <span className={css.zfName}>
                    {tg("name")} <span className={css.zfMenge}>× {garderobe}</span>
                  </span>
                  <span className={css.zfWert}>{preisText(garderobeCent, locale)}</span>
                </div>
              ) : null}
              {codeCent > 0 && code ? (
                <div className={css.zfZeile}>
                  <span className={css.zfName}>
                    {t("code.zeile")} <span className={css.zfMenge}>{code.code}</span>
                  </span>
                  <span className={css.zfWert}>− {preisText(codeCent, locale)}</span>
                </div>
              ) : null}
              {rabattCent > 0 ? (
                <div className={css.zfZeile}>
                  <span className={css.zfName}>Vorkasse-Rabatt</span>
                  <span className={css.zfWert}>− {preisText(rabattCent, locale)}</span>
                </div>
              ) : null}
            </div>

            <div className={css.zfTrenner} />

            <div className={css.zfSumme}>
              <span className={css.zfSummeLabel}>{t("gesamt")}</span>
              <span className={css.zfSummeWert}>{preisText(gesamtEndCent, locale)}</span>
            </div>
            <p className={css.zfSteuer}>{steuerhinweis(locale)}</p>
          </div>
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
  nurLesen = false,
}: {
  name: string;
  beschriftung: string;
  wert: string;
  aendern: (v: string) => void;
  typ?: string;
  fehler?: string;
  hinweis?: string;
  autoComplete?: string;
  /** Vorgegeben, z. B. durch eine Presale-Einladung */
  nurLesen?: boolean;
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
        readOnly={nurLesen}
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

/** "14:30" heute, sonst "Sa., 10:00" — immer Berliner Zeit. */
function fristText(iso: string, locale: string): string {
  const datum = new Date(iso);
  const tag = (d: Date) =>
    new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short" }).format(d);
  return new Intl.DateTimeFormat(locale, {
    ...(tag(datum) !== tag(new Date()) ? { weekday: "short" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(datum);
}

/**
 * Zeigt, wie lange die Tickets noch gehalten werden. Kein Druckmittel —
 * die Frist ist echt, sie steht als reserviert_bis in der Datenbank und
 * gibt das Kontingent danach wirklich frei.
 */
function Uhr({ bis }: { bis: string }) {
  const t = useTranslations("checkout");
  const locale = useLocale();
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

  // Angebote von der Warteliste halten Stunden. Eine Uhr, die "239:59"
  // zählt, sagt weniger als die Uhrzeit, bis zu der es gilt.
  if (rest > 60 * 60) {
    return <p className={css.uhr}>{t("reserviertBis", { zeit: fristText(bis, locale) })}</p>;
  }

  const minuten = String(Math.floor(rest / 60)).padStart(2, "0");
  const sekunden = String(rest % 60).padStart(2, "0");

  return (
    <p className={`${css.uhr} ${rest < 120 ? css.uhrKnapp : ""}`}>
      {t("reserviertNoch", { minuten, sekunden })}
    </p>
  );
}
