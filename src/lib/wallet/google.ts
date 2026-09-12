import { createSign } from "node:crypto";
import { PASS_FARBEN, type PassDaten } from "./typen";
import { eigeneAdresse } from "../stripe";

/**
 * Google-Wallet-Pässe.
 *
 * Anders als bei Apple gibt es keine Datei: Der Pass ist ein Datensatz
 * in Googles Speicher, und der „Speichern"-Knopf ist ein signiertes
 * Token, das darauf zeigt.
 *
 * Zwei Ebenen:
 *   Class  — je Event einmal (Name, Ort, Datum, Logo, Farben)
 *   Object — je Ticket einmal (Code, Sitz, Gast)
 *
 * Die Class wird angelegt, bevor das erste Ticket eines Events
 * gespeichert werden kann; das Object kann auch im Token stecken, ohne
 * vorher angelegt zu werden — genau das tun wir, damit ein Ticket keinen
 * zusätzlichen Aufruf braucht.
 */

type Dienstkonto = { client_email: string; private_key: string };

function dienstkonto(): Dienstkonto | null {
  const roh = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
  if (!roh) return null;
  try {
    // Die JSON-Datei steht entweder direkt in der Variablen oder
    // base64-verpackt — in Hosting-Oberflächen ist Letzteres robuster,
    // weil Zeilenumbrüche im Schlüssel sonst gern verlorengehen.
    const text = roh.trim().startsWith("{")
      ? roh
      : Buffer.from(roh, "base64").toString("utf8");
    const daten = JSON.parse(text) as Dienstkonto;
    return daten.client_email && daten.private_key ? daten : null;
  } catch {
    console.error("[wallet] GOOGLE_WALLET_SERVICE_ACCOUNT_JSON ist kein gültiges JSON.");
    return null;
  }
}

export function googleEingerichtet(): boolean {
  return Boolean(process.env.GOOGLE_WALLET_ISSUER_ID && dienstkonto());
}

const API = "https://walletobjects.googleapis.com/walletobjects/v1";

/** Kennung einer Class. Muss mit der Issuer-ID beginnen. */
function classId(eventId: string): string {
  return `${process.env.GOOGLE_WALLET_ISSUER_ID}.event-${eventId}`;
}

function objectId(code: string): string {
  return `${process.env.GOOGLE_WALLET_ISSUER_ID}.ticket-${code}`;
}

async function zugangstoken(): Promise<string> {
  const konto = dienstkonto();
  if (!konto) throw new Error("Google-Wallet-Dienstkonto fehlt.");

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    credentials: konto,
    scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Google-Anmeldung fehlgeschlagen.");
  return token.token;
}

/**
 * Legt die Class für ein Event an — oder lässt sie, wenn es sie gibt.
 *
 * Absichtlich kein Aktualisieren: Ändert sich der Eventname nachträglich,
 * müsste man entscheiden, ob bereits gespeicherte Pässe mitwandern. Das
 * ist eine eigene Frage, die erst ansteht, wenn sie auftritt.
 */
export async function stelleClassSicher(event: {
  id: string;
  titel: string;
  beginn: string;
  einlass: string | null;
  ortName: string;
  ortStadt: string;
  ortStrasse: string | null;
}): Promise<string> {
  const id = classId(event.id);
  const token = await zugangstoken();

  const vorhanden = await fetch(`${API}/eventTicketClass/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (vorhanden.ok) return id;

  const koerper = {
    id,
    issuerName: "Lunar Events",
    reviewStatus: "UNDER_REVIEW",
    eventName: { defaultValue: { language: "de-DE", value: event.titel } },
    venue: {
      name: { defaultValue: { language: "de-DE", value: event.ortName } },
      address: {
        defaultValue: {
          language: "de-DE",
          value: [event.ortStrasse, event.ortStadt].filter(Boolean).join(", "),
        },
      },
    },
    dateTime: {
      // Google erwartet Ortszeit ohne Zonenangabe oder mit Versatz.
      start: event.beginn,
      ...(event.einlass ? { doorsOpen: event.einlass } : {}),
    },
    logo: {
      sourceUri: { uri: `${eigeneAdresse()}/wallet/logo@3x.png` },
      contentDescription: {
        defaultValue: { language: "de-DE", value: "Lunar Events" },
      },
    },
    hexBackgroundColor: PASS_FARBEN.hintergrundHex,
  };

  const antwort = await fetch(`${API}/eventTicketClass`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(koerper),
  });

  if (!antwort.ok) {
    const grund = await antwort.text();
    throw new Error(`Google-Class anlegen: ${antwort.status} ${grund.slice(0, 300)}`);
  }

  return id;
}

/**
 * Der Link hinter „Zu Google Wallet hinzufügen".
 *
 * Das Ticket steckt vollständig im signierten Token — deshalb braucht es
 * keinen vorherigen Schreibzugriff je Ticket, und der Knopf funktioniert
 * auch dann noch, wenn Google gerade langsam ist.
 */
export function speicherLink(daten: PassDaten, eventId: string): string {
  const konto = dienstkonto();
  if (!konto || !process.env.GOOGLE_WALLET_ISSUER_ID) {
    throw new Error("Google Wallet ist nicht eingerichtet.");
  }

  const ticketObjekt = {
    id: objectId(daten.code),
    classId: classId(eventId),
    state: "ACTIVE",
    ticketHolderName: daten.gastName ?? undefined,
    ticketNumber: daten.bestellnummer,
    ticketType: {
      defaultValue: { language: "de-DE", value: daten.ticketArt },
    },
    ...(daten.platz
      ? {
          seatInfo: {
            seat: { defaultValue: { language: "de-DE", value: daten.platz } },
          },
        }
      : {}),
    barcode: {
      type: "QR_CODE",
      value: daten.code,
      alternateText: daten.code,
    },
    hexBackgroundColor: PASS_FARBEN.hintergrundHex,
    linksModuleData: {
      uris: [
        {
          uri: daten.ticketLink,
          description: "Alle Tickets dieser Bestellung",
          id: "tickets",
        },
      ],
    },
    textModulesData: [
      {
        id: "hinweis",
        header: "Am Einlass",
        body:
          "Code scannen lassen. Jeder Code gilt genau einmal — gib den Pass " +
          "nur an Leute weiter, denen du vertraust.",
      },
    ],
  };

  const jetzt = Math.floor(Date.now() / 1000);
  const nutzlast = {
    iss: konto.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: jetzt,
    payload: { eventTicketObjects: [ticketObjekt] },
    origins: [eigeneAdresse()],
  };

  const kopf = { alg: "RS256", typ: "JWT" };
  const teil = (wert: unknown) =>
    Buffer.from(JSON.stringify(wert)).toString("base64url");

  const zuSignieren = `${teil(kopf)}.${teil(nutzlast)}`;
  const signatur = createSign("RSA-SHA256")
    .update(zuSignieren)
    .sign(konto.private_key.replace(/\\n/g, "\n"), "base64url");

  return `https://pay.google.com/gp/v/save/${zuSignieren}.${signatur}`;
}
