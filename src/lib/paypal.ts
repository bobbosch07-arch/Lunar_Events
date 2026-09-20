/**
 * PayPal über die REST-Schnittstelle, ohne SDK.
 *
 * Das offizielle Server-SDK bringt viel mit, wovon wir nichts brauchen:
 * Wir erstellen eine Bestellung und buchen sie ab, zwei Aufrufe. Dafür
 * lohnt keine weitere Abhängigkeit, die bei jedem Update mitgepflegt
 * werden will.
 */

const LIVE = "https://api-m.paypal.com";
const SANDBOX = "https://api-m.sandbox.paypal.com";

export function paypalEingerichtet(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/**
 * Sandbox oder echtes Geld? PayPal verrät das nicht am Schlüssel, anders
 * als Stripe. Deshalb eine eigene Angabe — voreingestellt ist Sandbox,
 * denn versehentlich zu testen ist harmloser als versehentlich
 * abzubuchen.
 */
export function paypalLive(): boolean {
  return process.env.PAYPAL_UMGEBUNG === "live";
}

function basis(): string {
  return paypalLive() ? LIVE : SANDBOX;
}

type Token = { wert: string; laeuftAb: number };
let zwischenspeicher: Token | null = null;

async function zugangstoken(): Promise<string> {
  // PayPal-Token gelten mehrere Stunden. Für jeden Aufruf einen neuen zu
  // holen kostet eine zusätzliche Rundreise pro Bestellung.
  if (zwischenspeicher && zwischenspeicher.laeuftAb > Date.now() + 60_000) {
    return zwischenspeicher.wert;
  }

  const id = process.env.PAYPAL_CLIENT_ID;
  const geheim = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !geheim) throw new Error("PayPal-Zugangsdaten fehlen.");

  const antwort = await fetch(`${basis()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${geheim}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!antwort.ok) {
    throw new Error(`PayPal-Anmeldung fehlgeschlagen (${antwort.status})`);
  }

  const daten = (await antwort.json()) as { access_token: string; expires_in: number };
  zwischenspeicher = {
    wert: daten.access_token,
    laeuftAb: Date.now() + daten.expires_in * 1000,
  };
  return daten.access_token;
}

async function ruf<T>(
  pfad: string,
  optionen: { methode?: string; koerper?: unknown; idempotenz?: string } = {},
): Promise<T> {
  const kopf: Record<string, string> = {
    Authorization: `Bearer ${await zugangstoken()}`,
    "Content-Type": "application/json",
  };
  // Verhindert, dass ein wiederholter Aufruf zweimal abbucht.
  if (optionen.idempotenz) kopf["PayPal-Request-Id"] = optionen.idempotenz;

  const antwort = await fetch(`${basis()}${pfad}`, {
    method: optionen.methode ?? "GET",
    headers: kopf,
    body: optionen.koerper ? JSON.stringify(optionen.koerper) : undefined,
  });

  const text = await antwort.text();
  if (!antwort.ok) {
    throw new Error(`PayPal ${pfad} → ${antwort.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type PaypalBestellung = { id: string; status: string };

export async function erstelleBestellung(eingabe: {
  betragCent: number;
  bestellnummer: string;
  bestellungId: string;
  beschreibung: string;
}): Promise<PaypalBestellung> {
  return ruf<PaypalBestellung>("/v2/checkout/orders", {
    methode: "POST",
    idempotenz: `lunar-${eingabe.bestellungId}`,
    koerper: {
      intent: "CAPTURE",
      purchase_units: [
        {
          // Taucht in der PayPal-Abrechnung auf und macht den Abgleich
          // mit unseren Bestellungen möglich.
          custom_id: eingabe.bestellungId,
          invoice_id: eingabe.bestellnummer,
          description: eingabe.beschreibung.slice(0, 127),
          amount: {
            currency_code: "EUR",
            value: (eingabe.betragCent / 100).toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Lunar Events",
            locale: "de-DE",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
          },
        },
      },
    },
  });
}

export type Buchung = {
  id: string;
  status: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount?: { value: string; currency_code: string };
      }>;
    };
  }>;
};

/** Der tatsächlich eingezogene Betrag in Cent, oder null, wenn keiner dasteht. */
export function eingezogenCent(buchung: Buchung): number | null {
  const betrag = buchung.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
  if (!betrag || betrag.currency_code !== "EUR") return null;
  const cent = Math.round(Number(betrag.value) * 100);
  return Number.isFinite(cent) ? cent : null;
}

export async function bucheAb(bestellungId: string): Promise<Buchung> {
  return ruf<Buchung>(`/v2/checkout/orders/${bestellungId}/capture`, {
    methode: "POST",
    idempotenz: `lunar-capture-${bestellungId}`,
    koerper: {},
  });
}

export async function leseBestellung(id: string): Promise<Buchung> {
  return ruf<Buchung>(`/v2/checkout/orders/${id}`);
}
