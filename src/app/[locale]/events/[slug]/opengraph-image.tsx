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
 * Bewusst ohne Syne: Schriften lassen sich hier nur als TTF einbetten,
 * und ein Schriftdownload zur Laufzeit wäre ein Fehlerpunkt an genau der
 * Stelle, die immer funktionieren muss. Die Wiedererkennung trägt das
 * Logo, die Farbwelt und das Layout.
 */
export default async function Bild({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await holeEvent(slug);

  const logo = await readFile(
    join(process.cwd(), "public", "logo", "lunar-ivory.png"),
  );
  const logoQuelle = `data:image/png;base64,${logo.toString("base64")}`;

  const datum = event
    ? new Intl.DateTimeFormat("de-DE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Berlin",
      }).format(new Date(event.beginn))
    : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "linear-gradient(150deg, #16304C 0%, #0B1728 52%, #07111F 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* Goldschimmer oben rechts, wie im Hero */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -120,
            width: 640,
            height: 640,
            borderRadius: 9999,
            background:
              "radial-gradient(circle, rgba(198,161,91,0.30) 0%, rgba(198,161,91,0) 68%)",
          }}
        />

        <img src={logoQuelle} width={118} height={118} alt="" />

        {/* Kein Fragment um die drei Zeilen: Satori behandelt Fragmente
            nicht durchsichtig, die Kinder landen sonst nebeneinander
            statt untereinander. */}
        {event ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                fontSize: 24,
                letterSpacing: 8,
                textTransform: "uppercase",
                color: "#D4B873",
              }}
            >
              {`${event.kategorie} · ${event.ort.stadt}`}
            </div>
            <div
              style={{
                fontSize: event.titel.length > 22 ? 76 : 96,
                fontWeight: 700,
                lineHeight: 1.02,
                letterSpacing: -1,
                color: "#F8F7F3",
                textTransform: "uppercase",
              }}
            >
              {event.titel}
            </div>
            <div style={{ fontSize: 32, color: "#B9BEC6" }}>
              {`${datum} · ${event.ort.name}`}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.02,
              color: "#F8F7F3",
            }}
          >
            <div>YOUR NIGHT.</div>
            <div>ELEVATED.</div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 28,
            borderTop: "1px solid rgba(255,255,255,0.16)",
            fontSize: 24,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#B9BEC6",
          }}
        >
          <span>lunar-events.de</span>
          {event?.ab_preis_cent ? (
            <span style={{ color: "#E4CE98" }}>
              {`ab ${preisText(event.ab_preis_cent, "de")}`}
            </span>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
