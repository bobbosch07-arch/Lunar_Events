import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { WerbungAbmelden } from "@/components/WerbungAbmelden";
import css from "../../../promoter/[token]/promoter.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Einladungen abbestellen",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * Ziel des Abmeldelinks in jeder Einladung. Die Seite selbst prüft den
 * Token nicht und ändert nichts — das macht erst der Knopf.
 */
export default async function WerbungAbmeldenSeite({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("werbung");

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
          <h1 className={css.titel}>{t("titel")}</h1>
          <p className={css.intro}>{t("text")}</p>
        </div>
        <div className={css.abschnitt}>
          <WerbungAbmelden token={token} klasse={css.abschnittText} />
          <Link href="/" className={css.abschnittText}>
            {t("zurueck")}
          </Link>
        </div>
      </main>
    </div>
  );
}
