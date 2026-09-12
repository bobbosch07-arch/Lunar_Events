/**
 * Prüft die Wallet-Logik, bevor echte Zugangsdaten da sind.
 *
 *   node scripts/wallet-testen.mjs
 *
 * Dafür werden ein RSA-Schlüsselpaar und ein selbstsigniertes Zertifikat
 * erzeugt. Apple und Google würden beides ablehnen — aber alles
 * *davor* lässt sich damit prüfen: Wird ein gültiges JWT gebaut? Enthält
 * der Pass die richtigen Felder? Sind alle Bilder vorhanden? Genau da
 * stecken die Fehler, nicht in der Signatur selbst.
 */
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const WURZEL = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

let fehler = 0;
function pruefe(bedingung, text, zusatz = "") {
  console.log(`${bedingung ? "✓" : "✗"} ${text}${zusatz ? "  " + zusatz : ""}`);
  if (!bedingung) fehler++;
}

/* ---------- 1. Bilder ---------- */
console.log("\nApple verlangt feste Dateinamen und Größen:\n");

const NOETIG = {
  "icon.png": [29, 29],
  "icon@2x.png": [58, 58],
  "icon@3x.png": [87, 87],
  "logo.png": [160, 50],
  "logo@2x.png": [320, 100],
  "logo@3x.png": [480, 150],
  "strip.png": [375, 98],
  "strip@2x.png": [750, 196],
  "strip@3x.png": [1125, 294],
};

const ordner = join(WURZEL, "public", "wallet");
const vorhanden = await readdir(ordner).catch(() => []);

for (const [name, [b, h]] of Object.entries(NOETIG)) {
  if (!vorhanden.includes(name)) {
    pruefe(false, `${name} fehlt`);
    continue;
  }
  // PNG-Kopf: Breite und Höhe stehen als 32-Bit-Zahlen ab Byte 16.
  const daten = await readFile(join(ordner, name));
  const breite = daten.readUInt32BE(16);
  const hoehe = daten.readUInt32BE(20);
  pruefe(
    breite === b && hoehe === h,
    `${name.padEnd(14)} ${breite}x${hoehe}`,
    breite === b && hoehe === h ? "" : `erwartet ${b}x${h}`,
  );
}

/* ---------- 2. Google: Speicherlink ---------- */
console.log("\nGoogle-Wallet-Link (signiertes JWT):\n");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const teil = (wert) => Buffer.from(JSON.stringify(wert)).toString("base64url");

const ticketObjekt = {
  id: "3388000000000000000.ticket-ABC123",
  classId: "3388000000000000000.event-xyz",
  state: "ACTIVE",
  barcode: { type: "QR_CODE", value: "ABC123", alternateText: "ABC123" },
  hexBackgroundColor: "#07111F",
};

const nutzlast = {
  iss: "lunar@projekt.iam.gserviceaccount.com",
  aud: "google",
  typ: "savetowallet",
  iat: Math.floor(Date.now() / 1000),
  payload: { eventTicketObjects: [ticketObjekt] },
  origins: ["https://lunar-events.vercel.app"],
};

const kopf = { alg: "RS256", typ: "JWT" };
const zuSignieren = `${teil(kopf)}.${teil(nutzlast)}`;
const signatur = createSign("RSA-SHA256").update(zuSignieren).sign(privateKey, "base64url");
const link = `https://pay.google.com/gp/v/save/${zuSignieren}.${signatur}`;

const echt = createVerify("RSA-SHA256")
  .update(zuSignieren)
  .verify(publicKey, Buffer.from(signatur, "base64url"));

pruefe(echt, "Signatur lässt sich mit dem öffentlichen Schlüssel prüfen");
pruefe(link.startsWith("https://pay.google.com/gp/v/save/"), "Adresse ist die von Google");
pruefe(link.split(".").length >= 3, "Token hat drei Teile");

const zurueck = JSON.parse(
  Buffer.from(zuSignieren.split(".")[1], "base64url").toString(),
);
pruefe(zurueck.aud === "google", "Empfänger ist google", zurueck.aud);
pruefe(zurueck.typ === "savetowallet", "Typ stimmt", zurueck.typ);
pruefe(
  zurueck.payload.eventTicketObjects[0].barcode.value === "ABC123",
  "Der Ticketcode steht im Token",
);
pruefe(
  zurueck.payload.eventTicketObjects[0].classId.startsWith("3388"),
  "Class-Kennung beginnt mit der Issuer-ID",
);

// Länge ist kein Detail: Manche Mailprogramme und Messenger kürzen lange
// Adressen, und der Link steckt in einem Knopf.
pruefe(link.length < 8000, `Link bleibt handhabbar (${link.length} Zeichen)`);

/* ---------- 3. Apple: Passaufbau ---------- */
console.log("\nApple-Pass (Aufbau, ohne gültige Signatur):\n");

const { PKPass } = await import("passkit-generator");
const forge = (await import("node-forge")).default;

// Selbstsigniertes Zertifikat, nur damit die Bibliothek etwas zu
// signieren hat.
const paar = forge.pki.rsa.generateKeyPair(2048);
const zert = forge.pki.createCertificate();
zert.publicKey = paar.publicKey;
zert.serialNumber = "01";
zert.validity.notBefore = new Date();
zert.validity.notAfter = new Date(Date.now() + 398 * 86400000);
const wer = [{ name: "commonName", value: "Lunar Test" }];
zert.setSubject(wer);
zert.setIssuer(wer);
zert.sign(paar.privateKey);

const p12 = forge.asn1
  .toDer(
    forge.pkcs12.toPkcs12Asn1(paar.privateKey, [zert], "test", {
      algorithm: "3des",
    }),
  )
  .getBytes();
const p12Buffer = Buffer.from(p12, "binary");
const wwdrPem = forge.pki.certificateToPem(zert);

const bilder = {};
for (const name of Object.keys(NOETIG)) {
  bilder[name] = await readFile(join(ordner, name));
}

const beginn = new Date(Date.now() + 18 * 86400000);
const passJson = {
  formatVersion: 1,
  passTypeIdentifier: "pass.de.lunar-events.ticket",
  teamIdentifier: "TESTTEAM01",
  organizationName: "Lunar Events",
  description: "LUNAR NIGHT 03 — Ticket",
  serialNumber: "ABC123",
  backgroundColor: "rgb(7, 17, 31)",
  foregroundColor: "rgb(248, 247, 243)",
  labelColor: "rgb(212, 184, 115)",
  relevantDate: beginn.toISOString(),
  eventTicket: {
    primaryFields: [{ key: "event", label: "EVENT", value: "LUNAR NIGHT 03" }],
    secondaryFields: [{ key: "ort", label: "ORT", value: "Alte Werft, Frankfurt" }],
  },
  barcodes: [
    {
      format: "PKBarcodeFormatQR",
      message: "ABC123",
      messageEncoding: "iso-8859-1",
      altText: "ABC123",
    },
  ],
};

// Genau wie im echten Code: die .p12 in zwei PEM-Bloecke zerlegen.
// passkit-generator nimmt kein P12 entgegen -- das war der erste Fehler,
// den dieser Test gefunden hat.
const behaelter = forge.pkcs12.pkcs12FromAsn1(
  forge.asn1.fromDer(forge.util.createBuffer(p12Buffer.toString("binary"))),
  "test",
);
// Der Schluessel wird gleich wieder verschluesselt: passkit-generator
// lehnt eine leere Passphrase ab -- der zweite Fehler, den dieser Test
// gefunden hat.
const phrase = "nur-fuer-diesen-lauf";
let zertPem = null;
let keyPem = null;
for (const tasche of behaelter.safeContents) {
  for (const inhalt of tasche.safeBags) {
    if (inhalt.cert && !zertPem) zertPem = forge.pki.certificateToPem(inhalt.cert);
    if (inhalt.key && !keyPem) keyPem = forge.pki.encryptRsaPrivateKey(inhalt.key, phrase);
  }
}
pruefe(Boolean(zertPem), "Zertifikat aus der .p12 gelesen");
pruefe(Boolean(keyPem), "Privater Schluessel aus der .p12 gelesen");

try {
  const pass = new PKPass(
    { ...bilder, "pass.json": Buffer.from(JSON.stringify(passJson)) },
    {
      wwdr: Buffer.from(wwdrPem),
      signerCert: Buffer.from(zertPem),
      signerKey: Buffer.from(keyPem),
      signerKeyPassphrase: phrase,
    },
  );

  const datei = pass.getAsBuffer();
  pruefe(datei.length > 5000, `Pass entsteht (${Math.round(datei.length / 1024)} KB)`);
  // Ein ZIP beginnt mit "PK" — das erwartet auch Wallet.
  pruefe(datei[0] === 0x50 && datei[1] === 0x4b, "Ergebnis ist ein ZIP-Archiv");

  const inhalt = datei.toString("latin1");
  pruefe(inhalt.includes("pass.json"), "pass.json liegt im Archiv");
  pruefe(inhalt.includes("manifest.json"), "manifest.json liegt im Archiv");
  pruefe(inhalt.includes("signature"), "Signatur liegt im Archiv");
  pruefe(inhalt.includes("strip@3x.png"), "Bilder liegen im Archiv");
} catch (f) {
  pruefe(false, "Pass konnte nicht gebaut werden", f.message);
}

console.log(
  fehler === 0
    ? "\nAlles in Ordnung. Was hier nicht geprüft werden kann: ob Apple und " +
        "Google die echten Zertifikate akzeptieren — das zeigt erst ein " +
        "Gerät mit echten Schlüsseln.\n"
    : `\n${fehler} Prüfungen fehlgeschlagen.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
