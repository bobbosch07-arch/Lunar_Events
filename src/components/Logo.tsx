import Image from "next/image";

/**
 * Das Logo liegt als PNG in drei Einfaerbungen vor — die Geometrie ist in
 * allen dieselbe, nur die Farbe wechselt mit dem Untergrund. Nichts davon
 * wird zur Laufzeit gefaerbt oder verzerrt.
 */
const DATEIEN = {
  ivory: "/logo/lunar-ivory.png",
  navy: "/logo/lunar-navy.png",
  gold: "/logo/lunar-gold-flat.png",
} as const;

const MARKEN = {
  ivory: "/logo/mark-ivory.png",
  gold: "/logo/mark-gold.png",
} as const;

type Props = {
  /** Passend zum Untergrund waehlen: ivory auf Navy, navy auf Ivory. */
  ton?: keyof typeof DATEIEN;
  /** Hoehe in Pixeln; die Breite ergibt sich aus dem Seitenverhaeltnis. */
  hoehe?: number;
  /** Nur Mond und Sterne, ohne Schriftzug. */
  nurMarke?: boolean;
  prioritaet?: boolean;
  className?: string;
};

/** Seitenverhaeltnisse der Dateien, damit nichts springt. */
const VERHAELTNIS_VOLL = 1200 / 1200;
const VERHAELTNIS_MARKE = 512 / 317;

export function Logo({
  ton = "navy",
  hoehe = 32,
  nurMarke = false,
  prioritaet = false,
  className,
}: Props) {
  const quelle = nurMarke
    ? MARKEN[ton === "navy" ? "gold" : ton]
    : DATEIEN[ton];
  const verhaeltnis = nurMarke ? VERHAELTNIS_MARKE : VERHAELTNIS_VOLL;

  return (
    <Image
      src={quelle}
      alt="Lunar Events"
      width={Math.round(hoehe * verhaeltnis)}
      height={hoehe}
      priority={prioritaet}
      className={className}
      style={{ height: hoehe, width: "auto" }}
    />
  );
}
