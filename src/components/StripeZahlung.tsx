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
import { starteZahlung, starteZahlungAnDerTuer } from "@/app/aktionen/zahlung";
import css from "./Checkout.module.css";

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
};

export function StripeZahlung({ bestellungId, rueckkehr, freigegeben, tuerToken }: Props) {
  const t = useTranslations("checkout");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    (tuerToken ? starteZahlungAnDerTuer(tuerToken) : starteZahlung(bestellungId)).then((ergebnis) => {
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
  }, [bestellungId, tuerToken, t]);

  if (fehler) return <p className={css.stoerung}>{fehler}</p>;
  if (!clientSecret) return <p className={css.hinweis}>…</p>;

  /**
   * Stripe malt das Formular in einem eigenen Rahmen. Damit es nicht wie
   * ein Fremdkörper wirkt, bekommt es unsere Tokens mitgegeben — die
   * Werte stehen hier ausnahmsweise als Literale, weil Stripe keine
   * CSS-Variablen auflösen kann.
   */
  const optionen: StripeElementsOptions = {
    clientSecret,
    locale: "de",
    appearance: {
      theme: "flat",
      variables: {
        colorPrimary: "#0b1728",
        colorBackground: "#fcfbf8",
        colorText: "#101418",
        colorTextSecondary: "#5e6268",
        colorDanger: "#a64040",
        fontFamily: "var(--font-body), system-ui, sans-serif",
        fontSizeBase: "16px",
        borderRadius: "8px",
        spacingUnit: "4px",
      },
      rules: {
        ".Input": {
          border: "1px solid #e4e0d7",
          boxShadow: "none",
          padding: "12px 14px",
        },
        ".Input:focus": {
          border: "1px solid #0b1728",
          outline: "2px solid #d4b873",
          outlineOffset: "1px",
        },
        ".Label": {
          fontSize: "12px",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "#5e6268",
        },
        ".Tab": { border: "1px solid #e4e0d7", boxShadow: "none" },
        ".Tab--selected": {
          border: "1px solid #0b1728",
          boxShadow: "inset 3px 0 0 #c6a15b",
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

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || laeuft) return;

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
          disabled={!stripe || !bereit || !freigegeben || laeuft}
        >
          {laeuft ? "…" : t("jetztKaufen")}
        </Knopf>
      </div>

      <p className={css.sicher}>{t("sicher", { anbieter: "Stripe" })}</p>
    </form>
  );
}
