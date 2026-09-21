"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { useRouter } from "@/i18n/navigation";
import { paypalBestellungAnlegen, paypalAbschliessen } from "@/app/aktionen/paypal";
import css from "./Checkout.module.css";

type Props = {
  bestellungId: string;
  clientId: string;
  /** Die Zustimmungen müssen stehen, bevor gezahlt werden kann. */
  freigegeben: boolean;
};

export function PaypalZahlung({ bestellungId, clientId, freigegeben }: Props) {
  const router = useRouter();
  const t = useTranslations("checkout");
  const [fehler, setFehler] = useState<string | null>(null);

  return (
    <div className={css.zahlform}>
      <PayPalScriptProvider
        options={{
          clientId,
          currency: "EUR",
          locale: "de_DE",
          // Nur PayPal selbst. Karten laufen über Stripe — zwei Wege für
          // dasselbe Mittel würden den Abgleich unnötig verkomplizieren.
          components: "buttons",
          "disable-funding": "card,sofort,giropay",
        }}
      >
        {/* Die Schaltfläche gehört PayPal und lässt sich nicht deaktivieren.
            Deshalb liegt bei fehlender Zustimmung eine Sperrschicht darüber,
            statt den Knopf zu verstecken — wer klickt, soll erfahren, was
            noch fehlt. */}
        <div
          style={{ position: "relative" }}
          onClickCapture={(e) => {
            if (!freigegeben) {
              e.preventDefault();
              e.stopPropagation();
              setFehler(t("ppBedingungen"));
            }
          }}
        >
          <div
            style={{
              opacity: freigegeben ? 1 : 0.5,
              pointerEvents: freigegeben ? "auto" : "none",
            }}
          >
            <PayPalButtons
              style={{ layout: "vertical", shape: "rect", height: 48 }}
              createOrder={async () => {
                setFehler(null);
                const antwort = await paypalBestellungAnlegen(bestellungId);
                if (!antwort.ok) {
                  setFehler(
                    antwort.fehler === "abgelaufen"
                      ? t("abgelaufen")
                      : t("ppNichtVorbereitet"),
                  );
                  throw new Error(antwort.fehler);
                }
                return antwort.id;
              }}
              onApprove={async (daten) => {
                const antwort = await paypalAbschliessen(
                  bestellungId,
                  daten.orderID,
                );
                if (!antwort.ok) {
                  setFehler(
                    antwort.fehler === "bestaetigung"
                      ? t("ppTicketsFehlen")
                      : t("fehler"),
                  );
                  return;
                }
                router.push(`/checkout/bestaetigung?b=${bestellungId}`);
              }}
              onError={() => {
                setFehler(t("ppAbgebrochen"));
              }}
            />
          </div>
        </div>
      </PayPalScriptProvider>

      {fehler ? <p className={css.stoerung}>{fehler}</p> : null}
    </div>
  );
}
