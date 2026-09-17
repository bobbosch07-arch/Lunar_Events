/**
 * Einmalcodes für die Prüfskripte (RFC 6238, dasselbe Verfahren wie jede
 * Authenticator-App).
 *
 * Nur für Tests: Die echten Codes tippt ein Mensch aus seiner App ein. Hier
 * brauchen wir sie, weil die Zwei-Faktor-Pflicht sonst nicht prüfbar wäre —
 * ein Test, der den zweiten Faktor umgeht, prüft nichts.
 */
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Entschluesseln(text) {
  let bits = "";
  for (const zeichen of text.replace(/=+$/, "").toUpperCase()) {
    const wert = ALPHABET.indexOf(zeichen);
    if (wert < 0) continue;
    bits += wert.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Sechsstelliger Code zum angegebenen Zeitpunkt. */
export function totpCode(geheim, zeitMs = Date.now()) {
  const zaehler = Math.floor(zeitMs / 1000 / 30);
  const block = Buffer.alloc(8);
  block.writeBigUInt64BE(BigInt(zaehler));
  const hmac = createHmac("sha1", base32Entschluesseln(geheim)).update(block).digest();
  const versatz = hmac[hmac.length - 1] & 0x0f;
  const zahl =
    ((hmac[versatz] & 0x7f) << 24) |
    ((hmac[versatz + 1] & 0xff) << 16) |
    ((hmac[versatz + 2] & 0xff) << 8) |
    (hmac[versatz + 3] & 0xff);
  return String(zahl % 1_000_000).padStart(6, "0");
}

/**
 * Richtet für eine angemeldete Sitzung einen zweiten Faktor ein und
 * bestätigt ihn. Danach ist die Sitzung auf "aal2" — genau wie nach dem
 * Eintippen eines Codes im Browser.
 */
export async function richteZweitenFaktorEin(client, name = "Test") {
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `${name} ${Date.now()}`,
  });
  if (error) throw new Error(`Zweiter Faktor anlegen: ${error.message}`);

  const { error: fehler } = await client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totpCode(data.totp.secret),
  });
  if (fehler) throw new Error(`Zweiter Faktor bestätigen: ${fehler.message}`);
  return { faktorId: data.id, geheim: data.totp.secret };
}
