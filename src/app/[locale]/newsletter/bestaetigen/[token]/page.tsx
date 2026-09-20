import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { NewsletterAktion } from "@/components/NewsletterAktion";
import css from "../../../promoter/[token]/promoter.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Newsletter bestätigen",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Ziel des Bestätigungslinks. Die Seite ändert nichts — das macht der Knopf. */
export default async function NewsletterBestaetigenSeite({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("newsletter");

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="navy" hoehe={40} prioritaet />
          </Link>
        </div>
      </header>
      <main className={`seitenbreite ${css.inhalt}`}>
        <div className={css.kopfzeile}>
          <h1 className={css.titel}>{t("bestaetigenTitel")}</h1>
          <p className={css.intro}>{t("bestaetigenText")}</p>
        </div>
        <div className={css.abschnitt}>
          <NewsletterAktion token={token} art="bestaetigen" klasse={css.abschnittText} />
          <Link href="/" className={css.abschnittText}>
            {t("zurueck")}
          </Link>
        </div>
      </main>
    </div>
  );
}
