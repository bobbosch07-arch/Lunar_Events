import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/styles/crew/crew-tokens.css";
import "@/styles/crew/komponenten.css";
import "@phosphor-icons/web/bold";
import "@phosphor-icons/web/fill";
import "@/styles/crew/crew.css";

/**
 * Die Crew-App (Skin Lunar Events, Designs/crew-app). Eigene Tokens und
 * Komponenten statt der Website-Oberfläche; Schriften und Icons kommen aus
 * dem eigenen Bündel, nicht vom CDN — sonst fehlten sie ohne Netz.
 */
export const metadata: Metadata = {
  title: "Crew",
  robots: { index: false, follow: false },
  manifest: "/crew.webmanifest",
  appleWebApp: { capable: true, title: "Lunar Crew", statusBarStyle: "black-translucent" },
  icons: { apple: "/crew/app-icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#220a4f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <div className="crew">{children}</div>;
}
