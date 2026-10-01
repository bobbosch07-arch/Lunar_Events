"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useTranslations } from "next-intl";
import { Knopf } from "./Knopf";
import {
  starteZahlung,
  starteZahlungAnDerTuer,
  starteZahlungNachbuchung,
} from "@/app/aktionen/zahlung";
import css from "./Checkout.module.css";

/**
 * Fehlt eine Zustimmung, bleibt der Knopf trotzdem bedienbar und zeigt, was
 * fehlt. Ein stumm gesperrter Knopf wirkte auf dem iPhone kaputt (Kunde,
 * 19.09.2026): Wer eines der Häkchen übersah, tippte ins Leere.
 */
export const ZUSTIMMUNG_FEHLT = "Bitte setz zuerst oben alle Häkchen.";

export function zeigeFehlendeZustimmung() {
  const block = document.getElementById("zustimmungen");
  const offen = block?.querySelector<HTMLInputElement>("input[type=checkbox]:not(:checked)");
  (offen ?? block)?.scrollIntoView({ behavior: "smooth", block: "center" });
  offen?.focus({ preventScroll: true });
}

/** Wird einmal geladen und behalten — sonst holt jede Neuanzeige das Skript neu. */
let stripeVersprechen: Promise<Stripe | null> | null = null;

function stripeLaden() {
  stripeVersprechen ??= loadStripe(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
  );
  return stripeVersprechen;
}

type Props = {
  bestellungId: string;
  rueckkehr: string;
  /** Die Zustimmungen müssen stehen, bevor gezahlt werden kann. */
  freigegeben: boolean;
  /**
   * Abendkasse (0025): Der Gast zahlt am eigenen Handy, ohne Kassen-Cookie.
   * Der Zugangstoken aus dem QR-Code ist dann der Nachweis.
   */
  tuerToken?: string;
  /**
   * Nachgebuchte Garderobe (0027): Nachweis ist der Ticketlink der
   * ursprünglichen Bestellung, kein Cookie.
   */
  ticketToken?: string;
};

export function StripeZahlung({
  bestellungId,
  rueckkehr,
  freigegeben,
  tuerToken,
  ticketToken,
}: Props) {
  const t = useTranslations("checkout");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    (tuerToken
      ? starteZahlungAnDerTuer(tuerToken)
      : ticketToken
        ? starteZahlungNachbuchung(ticketToken, bestellungId)
        : starteZahlung(bestellungId)
    ).then((ergebnis) => {
      if (abgebrochen) return;
      if (ergebnis.ok) setClientSecret(ergebnis.clientSecret);
      else
        setFehler(
          ergebnis.fehler === "abgelaufen" ? t("abgelaufen") : t("fehler"),
        );
    });
    return () => {
      abgebrochen = true;
    };
  }, [bestellungId, tuerToken, ticketToken, t]);

  if (fehler) return <p className={css.stoerung}>{fehler}</p>;
  if (!clientSecret) return <p className={css.hinweis}>…</p>;

  /**
   * Stripe malt das Formular in einem eigenen Rahmen. Damit es nicht wie
   * ein Fremdkörper wirkt, bekommt es unsere Tokens mitgegeben — die
   * Werte stehen hier ausnahmsweise als Literale, weil Stripe keine
   * CSS-Variablen auflösen kann. Violett-Nacht (30.09.2026): Felder wie
   * die der Kasse (--grund-2, Lila-Weiß), Fokus und Auswahl in Mondgelb.
   * Ändert sich ein Token, muss der Wert hier mit.
   */
  const optionen: StripeElementsOptions = {
    clientSecret,
    locale: "de",
    appearance: {
      theme: "flat",
      variables: {
        colorPrimary: "#ffe14a",
        colorBackground: "#2d1260",
        colorText: "#f7f0ff",
        colorTextSecondary: "#c4b9d5",
        colorTextPlaceholder: "#9788b0",
        colorIcon: "#c4b9d5",
        colorDanger: "#ff9a9a",
        // Im Stripe-Rahmen gibt es unsere CSS-Variablen nicht — eine
        // var() machte die ganze Angabe ungültig, und Stripe fiel auf eine
        // Serifenschrift zurück. Systemschrift ist der ehrliche Ersatz.
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        fontSizeBase: "16px",
        borderRadius: "3px",
        spacingUnit: "4px",
      },
      rules: {
        ".Input": {
          border: "1px solid #4d3579",
          boxShadow: "none",
          padding: "12px 14px",
        },
        ".Input:focus": {
          border: "1px solid #f7f0ff",
          outline: "2px solid #ffe14a",
          outlineOffset: "1px",
        },
        ".Label": {
          fontSize: "12px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "#c4b9d5",
        },
        ".Tab": { border: "1px solid #4d3579", boxShadow: "none", backgroundColor: "#2d1260" },
        ".Tab--selected": {
          border: "1px solid #ffe14a",
          boxShadow: "4px 4px 0 #ffe14a",
        },
        ".TabLabel--selected": { color: "#ffe14a" },
        ".TabIcon--selected": { fill: "#ffe14a" },
        ".Block": { backgroundColor: "#2d1260", border: "1px solid #4d3579", boxShadow: "none" },
        // Die Zahlarten als aufklappbare Liste (Accordion) malt Stripe sonst weiß
        ".AccordionItem": {
          backgroundColor: "#2d1260",
          border: "1px solid #4d3579",
          boxShadow: "none",
          color: "#f7f0ff",
        },
        ".AccordionItem--selected": {
          border: "1px solid #ffe14a",
          boxShadow: "4px 4px 0 #ffe14a",
          color: "#ffe14a",
        },
      },
    },
  };

  return (
    <Elements stripe={stripeLaden()} options={optionen}>
      <Formular rueckkehr={rueckkehr} freigegeben={freigegeben} />
    </Elements>
  );
}

function Formular({
  rueckkehr,
  freigegeben,
}: {
  rueckkehr: string;
  freigegeben: boolean;
}) {
  const t = useTranslations("checkout");
  const stripe = useStripe();
  const elements = useElements();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false);

  // Sind die Häkchen nachgeholt, verschwindet der Hinweis von selbst.
  useEffect(() => {
    if (freigegeben) setFehler((f) => (f === ZUSTIMMUNG_FEHLT ? null : f));
  }, [freigegeben]);

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || laeuft) return;
    if (!freigegeben) {
      setFehler(ZUSTIMMUNG_FEHLT);
      zeigeFehlendeZustimmung();
      return;
    }

    setLaeuft(true);
    setFehler(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: rueckkehr },
    });

    // Hierher kommt der Code nur, wenn die Zahlung *nicht* geklappt hat —
    // sonst hat Stripe längst weitergeleitet.
    setLaeuft(false);
    setFehler(
      error?.type === "card_error" || error?.type === "validation_error"
        ? (error.message ?? t("fehler"))
        : t("fehler"),
    );
  }

  return (
    <form onSubmit={absenden} className={css.zahlform}>
      <PaymentElement onReady={() => setBereit(true)} />

      {fehler ? <p className={css.stoerung}>{fehler}</p> : null}

      <div className={css.knoepfe}>
        <Knopf
          type="submit"
          groesse="gross"
          disabled={!stripe || !bereit || laeuft}
        >
          {laeuft ? "…" : t("jetztKaufen")}
        </Knopf>
      </div>

      <p className={css.sicher}>{t("sicher", { anbieter: "Stripe" })}</p>
    </form>
  );
}
