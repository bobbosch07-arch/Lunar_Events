import type { Metadata } from "next";
import { Syne, DM_Sans, Unbounded, Instrument_Serif } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Betriebshinweis } from "@/components/Betriebshinweis";
import { CodeMerker } from "@/components/CodeMerker";
import "../globals.css";

/**
 * Violett-Nacht (30.09.2026): Unbounded für Überschriften und Knöpfe,
 * Instrument Serif kursiv für das eine Akzentwort, DM Sans für alles
 * andere. Syne bleibt für den klassischen Look der Personal-Werkzeuge
 * und wird deshalb nicht vorgeladen — Gäste brauchen sie nie.
 *
 * Alle Schriften liefert next/font selbst aus — kein Aufruf bei Google
 * beim Seitenaufruf, kein Nachladeruckeln, und der Consent-Banner muss
 * nichts dazu sagen.
 */
const unbounded = Unbounded({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-unbounded",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-akzent",
  display: "swap",
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
  preload: false,
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    title: {
      default: t("titel"),
      template: t("titelVorlage", { seite: "%s" }),
    },
    description: t("beschreibung"),
    openGraph: {
      type: "website",
      siteName: "Lunar Events",
      title: t("titel"),
      description: t("beschreibung"),
      locale: locale === "de" ? "de_DE" : "en_GB",
    },
    twitter: { card: "summary_large_image" },
    icons: { icon: "/favicon.ico" },
  };
}

/**
 * Die Farbe der Browserleiste auf dem Handy: die Nacht, auf der jede
 * Kundenseite beginnt. Eine helle Leiste über dunklem Inhalt sähe aus
 * wie ein Ladefehler.
 */
export const viewport = {
  themeColor: "#1a0840",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Ohne das faellt jede Seite auf dynamisches Rendern zurueck.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${unbounded.variable} ${instrumentSerif.variable} ${syne.variable} ${dmSans.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          <Betriebshinweis />
          <CodeMerker />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
