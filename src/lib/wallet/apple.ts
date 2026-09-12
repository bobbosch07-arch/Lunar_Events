import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PKPass } from "passkit-generator";
import { PASS_FARBEN, type PassDaten } from "./typen";

/**
 * Apple-Wallet-Pässe (.pkpass).
 *
 * Ein Pass ist ein ZIP aus pass.json, Bildern, einer Liste von
 * SHA1-Prüfsummen und einer PKCS#7-Signatur. Signiert wird mit einem
 * Zertifikat, das Apple auf eine Pass Type ID ausstellt — deshalb geht
 * hier ohne Apple-Developer-Konto nichts.
 */

export function appleEingerichtet(): boolean {
  return Boolean(
    process.env.APPLE_WALLET_TEAM_ID &&
      process.env.APPLE_WALLET_PASS_TYPE_ID &&
      process.env.APPLE_WALLET_ZERTIFIKAT_P12_BASE64,
  );
}

/** Die Bilder liegen unter public/, damit sie im Deployment landen. */
async function bilder(): Promise<Record<string, Buffer>> {
  const ordner = join(process.cwd(), "public", "wallet");
  const namen = [
    "icon.png",
    "icon@2x.png",
    "icon@3x.png",
    "logo.png",
    "logo@2x.png",
    "logo@3x.png",
    "strip.png",
    "strip@2x.png",
    "strip@3x.png",
  ];

  const eintraege = await Promise.all(
    namen.map(async (name) => [name, await readFile(join(ordner, name))] as const),
  );
  return Object.fromEntries(eintraege);
}

/**
 * Das WWDR-Zwischenzertifikat von Apple. Ohne das prüft kein Gerät die
 * Signatur — es ist öffentlich, aber es muss dabei sein.
 */
function wwdr(): Buffer {
  const roh = process.env.APPLE_WALLET_WWDR_PEM;
  if (!roh) {
    throw new Error(
      "APPLE_WALLET_WWDR_PEM fehlt. Das Zwischenzertifikat lädt man bei " +
        "Apple herunter (AppleWWDRCAG4) und trägt es als PEM ein.",
    );
  }
  return Buffer.from(roh.includes("BEGIN") ? roh : Buffer.from(roh, "base64").toString());
}

export async function erzeugeApplePass(daten: PassDaten): Promise<Buffer> {
  if (!appleEingerichtet()) {
    throw new Error("Apple Wallet ist nicht eingerichtet.");
  }

  const beginn = new Date(daten.beginn);
  const ort = [daten.ortName, daten.ortStrasse, daten.ortStadt]
    .filter(Boolean)
    .join(", ");

  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: process.env.APPLE_WALLET_PASS_TYPE_ID!,
    teamIdentifier: process.env.APPLE_WALLET_TEAM_ID!,
    organizationName: "Lunar Events",
    description: `${daten.eventTitel} — Ticket`,
    // Die Seriennummer ist der Ticketcode: So erkennt Wallet einen
    // bereits gespeicherten Pass wieder, statt ihn zu verdoppeln.
    serialNumber: daten.code,

    backgroundColor: PASS_FARBEN.hintergrundRgb,
    foregroundColor: PASS_FARBEN.schriftRgb,
    labelColor: PASS_FARBEN.nebenschriftRgb,

    // Der Pass taucht von selbst auf dem Sperrbildschirm auf: eine Stunde
    // vor Beginn, und wenn das Telefon in die Nähe des Ortes kommt. Das
    // ist der eigentliche Gewinn gegenüber einem Link.
    relevantDate: (daten.einlass ? new Date(daten.einlass) : beginn).toISOString(),
    ...(daten.lat !== null && daten.lng !== null
      ? {
          locations: [
            {
              latitude: daten.lat,
              longitude: daten.lng,
              relevantText: `${daten.eventTitel} — dein Ticket`,
            },
          ],
          maxDistance: 500,
        }
      : {}),

    eventTicket: {
      headerFields: [
        {
          key: "beginn",
          label: "BEGINN",
          value: beginn.toISOString(),
          dateStyle: "PKDateStyleNone",
          timeStyle: "PKDateStyleShort",
        },
      ],
      primaryFields: [
        { key: "event", label: "EVENT", value: daten.eventTitel },
      ],
      secondaryFields: [
        {
          key: "datum",
          label: "DATUM",
          value: beginn.toISOString(),
          dateStyle: "PKDateStyleMedium",
          timeStyle: "PKDateStyleNone",
        },
        { key: "ort", label: "ORT", value: `${daten.ortName}, ${daten.ortStadt}` },
      ],
      auxiliaryFields: [
        { key: "typ", label: "TICKET", value: daten.ticketArt },
        ...(daten.platz
          ? [{ key: "platz", label: "PLATZ", value: daten.platz }]
          : []),
        ...(daten.gastName
          ? [{ key: "gast", label: "GAST", value: daten.gastName }]
          : []),
      ],
      backFields: [
        { key: "adresse", label: "Adresse", value: ort },
        ...(daten.einlass
          ? [
              {
                key: "einlass",
                label: "Einlass",
                value: new Date(daten.einlass).toISOString(),
                dateStyle: "PKDateStyleNone",
                timeStyle: "PKDateStyleShort",
              },
            ]
          : []),
        { key: "bestellung", label: "Bestellnummer", value: daten.bestellnummer },
        { key: "code", label: "Ticketcode", value: daten.code },
        {
          key: "hinweis",
          label: "Am Einlass",
          value:
            "Code scannen lassen. Jeder Code gilt genau einmal — gib den Pass " +
            "nur an Leute weiter, denen du vertraust.",
        },
        { key: "link", label: "Alle Tickets", value: daten.ticketLink },
      ],
    },

    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: daten.code,
        messageEncoding: "iso-8859-1",
        altText: daten.code,
      },
    ],
  };

  const { zertifikatPem, schluesselPem, passphrase } = await zerlegeP12();

  const pass = new PKPass(
    {
      ...(await bilder()),
      "pass.json": Buffer.from(JSON.stringify(passJson)),
    },
    {
      wwdr: wwdr(),
      signerCert: Buffer.from(zertifikatPem),
      signerKey: Buffer.from(schluesselPem),
      signerKeyPassphrase: passphrase,
    },
  );

  return pass.getAsBuffer();
}

/**
 * Zerlegt die .p12 in Zertifikat und privaten Schlüssel, beides als PEM.
 *
 * Apple liefert ein `.cer`, das man zusammen mit dem privaten Schlüssel
 * in eine `.p12` packt — so kennt man es, und so gibt man es weiter. Die
 * Signaturbibliothek will aber zwei getrennte PEM-Blöcke. Ohne diesen
 * Schritt scheitert das Signieren mit „Invalid PEM formatted message",
 * und zwar erst dann, wenn echte Zertifikate im Spiel sind.
 *
 * Der herausgelöste Schlüssel wird gleich wieder verschlüsselt: Die
 * Bibliothek besteht auf einer Passphrase und lehnt eine leere ab. Die
 * Phrase wird hier erzeugt, gilt für diesen einen Aufruf und verlässt
 * den Prozess nie.
 */
async function zerlegeP12(): Promise<{
  zertifikatPem: string;
  schluesselPem: string;
  passphrase: string;
}> {
  const forge = await import("node-forge");
  const roh = Buffer.from(
    process.env.APPLE_WALLET_ZERTIFIKAT_P12_BASE64!,
    "base64",
  ).toString("binary");

  const behaelter = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(forge.util.createBuffer(roh)),
    process.env.APPLE_WALLET_ZERTIFIKAT_PASSWORT ?? "",
  );

  const passphrase = randomBytes(24).toString("hex");
  let zertifikatPem: string | null = null;
  let schluesselPem: string | null = null;

  for (const tasche of behaelter.safeContents) {
    for (const inhalt of tasche.safeBags) {
      if (inhalt.cert && !zertifikatPem) {
        zertifikatPem = forge.pki.certificateToPem(inhalt.cert);
      }
      if (inhalt.key && !schluesselPem) {
        schluesselPem = forge.pki.encryptRsaPrivateKey(inhalt.key, passphrase);
      }
    }
  }

  if (!zertifikatPem || !schluesselPem) {
    throw new Error(
      "Die .p12 enthält kein Zertifikat oder keinen privaten Schlüssel. " +
        "Beim Exportieren muss der Schlüssel mit eingepackt werden.",
    );
  }

  return { zertifikatPem, schluesselPem, passphrase };
}

/**
 * Wann läuft das Signaturzertifikat ab?
 *
 * Apple stellt es für 398 Tage aus. Danach lassen sich keine neuen Pässe
 * mehr ausstellen — bereits ausgegebene bleiben gültig. Das fällt sonst
 * mitten im Vorverkauf auf, deshalb warnt das Backoffice vorher.
 */
export async function zertifikatLaeuftAb(): Promise<Date | null> {
  const p12 = process.env.APPLE_WALLET_ZERTIFIKAT_P12_BASE64;
  if (!p12) return null;

  try {
    const forge = await import("node-forge");
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(Buffer.from(p12, "base64").toString("binary")),
    );
    const behaelter = forge.pkcs12.pkcs12FromAsn1(
      asn1,
      process.env.APPLE_WALLET_ZERTIFIKAT_PASSWORT ?? "",
    );

    for (const tasche of behaelter.safeContents) {
      for (const inhalt of tasche.safeBags) {
        const zertifikat = (inhalt as { cert?: { validity: { notAfter: Date } } }).cert;
        if (zertifikat) return zertifikat.validity.notAfter;
      }
    }
    return null;
  } catch (fehler) {
    console.error("[wallet] Zertifikat nicht lesbar:", (fehler as Error).message);
    return null;
  }
}
