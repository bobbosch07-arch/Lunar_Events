import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Lunar Events · See you after dark";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Das Vorschaubild für alle Seiten ohne eigenes (Startseite, About, FAQ …):
 * das Sub-Logo mit Slogan auf dem violetten Himmel. Eventseiten haben ihr
 * eigenes Poster (events/[slug]/opengraph-image.tsx).
 */
export default async function Bild() {
  const slogan = await readFile(join(process.cwd(), "public", "logo", "lunar-slogan.png"));
  const quelle = `data:image/png;base64,${slogan.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          background:
            "radial-gradient(70% 60% at 10% 0%, rgba(255,143,214,0.45) 0%, rgba(255,143,214,0) 70%), radial-gradient(110% 90% at 92% 12%, #8a4dff 0%, #5b21c9 38%, #2e0e6b 72%, #1a0840 100%)",
          fontFamily: "sans-serif",
          color: "#c4b9d5",
        }}
      >
        <img src={quelle} width={840} height={313} alt="" />
        <div style={{ fontSize: 30, letterSpacing: 3 }}>Ausgewählte Nächte in Darmstadt · lunar-events.de</div>
      </div>
    ),
    size,
  );
}
