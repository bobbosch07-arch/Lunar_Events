/**
 * Erzeugt die Cosmos-Bilder für Mails aus public/cosmos.
 *
 *   node scripts/mail_bilder.mjs
 *
 * Mailprogramme zeigen keine SVGs (Gmail und Outlook blenden sie aus),
 * deshalb liegen die Widgets für Mails als PNG in public/mail, doppelt so
 * groß wie angezeigt, damit sie auf Handys scharf bleiben. Ändert sich ein
 * Widget in Designs/cosmos, dieses Skript neu laufen lassen.
 *
 *   kopf-deko.png     300×180 (angezeigt 150×90)  rosa Planet mit Funkeln, rechts im Kopf
 *   trenner.png       1120×224 (angezeigt 560×112) Sternschnuppe und Planet über dem Fuß
 *   sternenstaub.png  480×480, kachelbar           Hintergrund hinter der Mail
 *   funkeln.png       48×48 (angezeigt 24×24)       einzelnes gelbes Funkeln
 */
import sharp from "sharp";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const WURZEL = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const QUELLE = join(WURZEL, "public", "cosmos");
const ZIEL = join(WURZEL, "public", "mail");
await mkdir(ZIEL, { recursive: true });

const leer = { r: 0, g: 0, b: 0, alpha: 0 };

/** Ein Widget als PNG-Puffer in der gewünschten Größe. */
async function teil(name, groesse) {
  const svg = await readFile(join(QUELLE, `${name}.svg`));
  return sharp(svg, { density: 300 })
    .resize(groesse, groesse, { fit: "contain", background: leer })
    .png()
    .toBuffer();
}

// Kopf: rosa Planet rechts (wie auf der Ticketseite; der Ringplanet steckt
// schon im Trenner), Funkeln links davon. Durchsichtig, liegt auf dem
// violetten Verlauf des Kopfes.
await sharp({ create: { width: 300, height: 180, channels: 4, background: leer } })
  .composite([
    { input: await teil("planet-pink", 170), left: 130, top: 4 },
    { input: await teil("sparkle-yellow", 44), left: 70, top: 22 },
    { input: await teil("sparkle-pink", 30), left: 104, top: 120 },
    { input: await teil("sparkle-white", 20), left: 28, top: 96 },
  ])
  .png()
  .toFile(join(ZIEL, "kopf-deko.png"));

await sharp(await readFile(join(QUELLE, "divider-cosmos.svg")), { density: 200 })
  .resize(1120, 224)
  .png()
  .toFile(join(ZIEL, "trenner.png"));

await sharp(await readFile(join(QUELLE, "stardust-tile.svg")))
  .resize(480, 480)
  .png()
  .toFile(join(ZIEL, "sternenstaub.png"));

await sharp(await teil("sparkle-yellow", 48)).toFile(join(ZIEL, "funkeln.png"));

console.log("Mail-Bilder in public/mail erzeugt.");
