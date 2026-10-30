/**
 * Erzeugt Symbol und Startbild der Android-App aus public/crew/app-icon-512.png:
 * klassische Symbole (eckig und rund), das adaptive Symbol (Vordergrund mit
 * Rand, damit die Maske des Startbildschirms den Mond nicht anschneidet) und
 * die Startbilder statt des Capacitor-Logos. Danach neu bauen.
 *
 *   node scripts/android-symbole.mjs
 */
import sharp from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const QUELLE = "public/crew/app-icon-512.png";
const RES = "android/app/src/main/res";
const DICHTEN = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// Grundfarbe aus der Ecke des Symbols, damit Rand und Startbild nahtlos passen.
const { data } = await sharp(QUELLE).extract({ left: 4, top: 4, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
const grund = { r: data[0], g: data[1], b: data[2], alpha: 1 };
const hex = `#${[data[0], data[1], data[2]].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

const rund = (n) => Buffer.from(`<svg width="${n}" height="${n}"><circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}"/></svg>`);

for (const [dichte, f] of Object.entries(DICHTEN)) {
  const ordner = join(RES, `mipmap-${dichte}`);
  const n = Math.round(48 * f);
  await sharp(QUELLE).resize(n, n).png().toFile(join(ordner, "ic_launcher.png"));
  await sharp(QUELLE).resize(n, n).composite([{ input: rund(n), blend: "dest-in" }]).png().toFile(join(ordner, "ic_launcher_round.png"));
  // Adaptiv: 108 dp Fläche, sichtbar sind nur die inneren 72 dp — das Symbol
  // bekommt 84 dp, der Rest ist Grundfarbe.
  const flaeche = Math.round(108 * f);
  const innen = Math.round(84 * f);
  const symbol = await sharp(QUELLE).resize(innen, innen).png().toBuffer();
  await sharp({ create: { width: flaeche, height: flaeche, channels: 4, background: grund } })
    .composite([{ input: symbol, gravity: "center" }])
    .png()
    .toFile(join(ordner, "ic_launcher_foreground.png"));
}

writeFileSync(
  join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`,
);

// Startbilder: jede vorhandene splash.png in ihrer Größe neu, Symbol mittig.
let startbilder = 0;
for (const ordner of readdirSync(RES).filter((o) => o.startsWith("drawable"))) {
  const pfad = join(RES, ordner, "splash.png");
  let meta;
  try {
    meta = await sharp(pfad).metadata();
  } catch {
    continue;
  }
  const kante = Math.round(Math.min(meta.width, meta.height) * 0.32);
  const symbol = await sharp(QUELLE).resize(kante, kante).png().toBuffer();
  const neu = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: grund } })
    .composite([{ input: symbol, gravity: "center" }])
    .png()
    .toBuffer();
  writeFileSync(pfad, neu);
  startbilder++;
}

console.log(`Symbole erzeugt (Grund ${hex}), ${startbilder} Startbilder ersetzt.`);
