"use client";

import { useState } from "react";
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
              setFehler("Bitte zuerst die Bedingungen bestätigen.");
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
                      ? "Die Reservierung ist abgelaufen. Bitte wähle die Tickets neu."
                      : "Die Zahlung konnte nicht vorbereitet werden.",
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
                      ? "Die Zahlung ist durch, aber die Tickets fehlen noch. Melde dich bitte mit deiner Bestellnummer — wir stellen sie sofort aus."
                      : "Die Zahlung ist nicht durchgegangen. Es wurde nichts abgebucht.",
                  );
                  return;
                }
                router.push(`/checkout/bestaetigung?b=${bestellungId}`);
              }}
              onError={() => {
                setFehler("PayPal hat abgebrochen. Versuch es bitte noch einmal.");
              }}
            />
          </div>
        </div>
      </PayPalScriptProvider>

      {fehler ? <p className={css.stoerung}>{fehler}</p> : null}
    </div>
  );
}
