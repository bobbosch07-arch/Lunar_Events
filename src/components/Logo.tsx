import Image from "next/image";

/**
 * Das Logo als Bild. Seit 30.09.2026 gibt es das farbige Logo für
 * Violett-Nacht (gelbe Sichel, rosa Sterne, "LUNAR" Lila-Weiß, "EVENTS"
 * Rosa) — von Bobbo als fertige Datei geliefert, hier nur zugeschnitten.
 * Die alten Einfärbungen (ivory, navy, gold) bleiben für den klassischen
 * Look der Personal-Werkzeuge. Nichts davon wird zur Laufzeit gefärbt
 * oder verzerrt.
 */
const DATEIEN = {
  farbig: { src: "/logo/lunar-farbig.png", verhaeltnis: 718 / 456 },
  ivory: { src: "/logo/lunar-ivory.png", verhaeltnis: 1 },
  navy: { src: "/logo/lunar-navy.png", verhaeltnis: 1 },
  gold: { src: "/logo/lunar-gold-flat.png", verhaeltnis: 1 },
} as const;

const MARKEN = {
  farbig: { src: "/logo/mark-farbig.png", verhaeltnis: 263 / 268 },
  ivory: { src: "/logo/mark-ivory.png", verhaeltnis: 512 / 317 },
  gold: { src: "/logo/mark-gold.png", verhaeltnis: 512 / 317 },
} as const;

type Props = {
  /** farbig auf Violett-Nacht; ivory auf Navy, navy auf Ivory im klassischen Look. */
  ton?: keyof typeof DATEIEN;
  /** Hoehe in Pixeln; die Breite ergibt sich aus dem Seitenverhaeltnis. */
  hoehe?: number;
  /** Nur Mond und Sterne, ohne Schriftzug. */
  nurMarke?: boolean;
  prioritaet?: boolean;
  className?: string;
};

export function Logo({
  ton = "farbig",
  hoehe = 32,
  nurMarke = false,
  prioritaet = false,
  className,
}: Props) {
  const datei = nurMarke ? MARKEN[ton === "navy" ? "gold" : ton] : DATEIEN[ton];

  return (
    <Image
      src={datei.src}
      alt="Lunar Events"
      width={Math.round(hoehe * datei.verhaeltnis)}
      height={hoehe}
      priority={prioritaet}
      className={className}
      style={{ height: hoehe, width: "auto" }}
    />
  );
}

/**
 * Das Sub-Logo: Sichel mit dem Slogan "SEE YOU after dark". Für Stellen,
 * an denen der Name schon steht und die Marke nur noch grüßt
 * (Fußzeile, Ticket).
 */
export function SloganLogo({ hoehe = 64, className }: { hoehe?: number; className?: string }) {
  return (
    <Image
      src="/logo/lunar-slogan.png"
      alt="Lunar Events · See you after dark"
      width={Math.round((hoehe * 1044) / 389)}
      height={hoehe}
      className={className}
      style={{ height: hoehe, width: "auto" }}
    />
  );
}
