import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { holeEvent } from "@/lib/events";
import { preisText } from "@/lib/format";

export const alt = "Lunar Events";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Das Bild, das erscheint, wenn jemand einen Eventlink in WhatsApp oder
 * Instagram teilt. Für ein Eventgeschäft ist das keine Nebensache — so
 * reisen die Links.
 *
 * Violett-Nacht (30.09.2026) als Poster: Verlauf, die Sichel aus dem Logo
 * groß angeschnitten, rosa Datumskasten, Preis in Mondgelb. Farben als
 * Literale, weil hier keine CSS-Variablen gelten (Werte wie tokens.css).
 *
 * Bewusst ohne Unbounded: Schriften lassen sich hier nur als TTF/WOFF
 * einbetten, und ein Schriftdownload zur Laufzeit wäre ein Fehlerpunkt an
 * genau der Stelle, die immer funktionieren muss. Die Wiedererkennung
 * tragen Sichel, Farbwelt und Layout.
 */
export default async function Bild({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await holeEvent(slug);

  const marke = await readFile(join(process.cwd(), "public", "logo", "mark-farbig.png"));
  const markeQuelle = `data:image/png;base64,${marke.toString("base64")}`;

  const beginn = event ? new Date(event.beginn) : null;
  const teil = (o: Intl.DateTimeFormatOptions) =>
    beginn
      ? new Intl.DateTimeFormat("de-DE", { ...o, timeZone: "Europe/Berlin" }).format(beginn)
      : "";
  const tag = teil({ day: "2-digit" });
  const monat = teil({ month: "short" }).replace(".", "").toUpperCase();
  const datum = teil({ weekday: "long", day: "2-digit", month: "long" });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "linear-gradient(160deg, #8a4dff 0%, #5b21c9 45%, #220a4f 100%)",
          fontFamily: "sans-serif",
          color: "#f7f0ff",
        }}
      >
        {/* Die Sichel aus dem Logo, groß und rechts angeschnitten */}
        <img
          src={markeQuelle}
          width={560}
          height={570}
          alt=""
          style={{ position: "absolute", right: -70, top: -60 }}
        />

        {event ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              alignSelf: "flex-start",
              padding: "14px 18px 12px",
              background: "#ff8fd6",
              color: "#2a0b5e",
              lineHeight: 1,
            }}
          >
            <div style={{ fontSize: 56, fontWeight: 900 }}>{tag}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, marginTop: 6 }}>{monat}</div>
          </div>
        ) : (
          <div style={{ display: "flex" }} />
        )}

        {/* Kein Fragment um die Zeilen: Satori behandelt Fragmente nicht
            durchsichtig, die Kinder landen sonst nebeneinander statt
            untereinander. */}
        {event ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 6,
                textTransform: "uppercase",
                color: "#ffe14a",
              }}
            >
              {`${event.kategorie} · ${event.ort.stadt}`}
            </div>
            <div
              style={{
                fontSize: event.titel.length > 22 ? 78 : 104,
                fontWeight: 900,
                lineHeight: 0.98,
                letterSpacing: -2,
                textTransform: "uppercase",
              }}
            >
              {event.titel}
            </div>
            <div style={{ fontSize: 30, color: "#c4b9d5" }}>{`${datum} · ${event.ort.name}`}</div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 96,
              fontWeight: 900,
              lineHeight: 1,
              textTransform: "uppercase",
            }}
          >
            <div>See you</div>
            <div>after dark.</div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#c4b9d5",
          }}
        >
          <span>Lunar Events · lunar-events.de</span>
          {event?.ab_preis_cent ? (
            <span
              style={{
                padding: "12px 20px",
                background: "#ffe14a",
                color: "#2a0b5e",
                letterSpacing: 2,
                borderRight: "6px solid #ff8fd6",
                borderBottom: "6px solid #ff8fd6",
              }}
            >
              {`ab ${preisText(event.ab_preis_cent, "de")}`}
            </span>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
