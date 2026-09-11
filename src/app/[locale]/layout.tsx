import type { Metadata } from "next";
import { Syne, DM_Sans } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Betriebshinweis } from "@/components/Betriebshinweis";
import "../globals.css";

/**
 * Richtung 03 "Contemporary Nightlife". Beide Schriften werden von
 * next/font selbst ausgeliefert — kein Aufruf bei Google beim Seitenaufruf,
 * kein Nachladeruckeln, und der Consent-Banner muss nichts dazu sagen.
 */
const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
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
    <html lang={locale} className={`${syne.variable} ${dmSans.variable}`}>
      <body>
        <NextIntlClientProvider>
          <Betriebshinweis />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
