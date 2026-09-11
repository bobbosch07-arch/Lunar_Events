import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { VipFormular, type EventWahl } from "@/components/VipFormular";
import { holeKommendeEvents } from "@/lib/events";
import css from "./vip.module.css";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ event?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "vip" });
  return { title: t("formTitel"), description: t("text") };
}

const LEISTUNGEN = ["tisch", "service", "einlass", "absprache"] as const;

export default async function VipSeite({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { event } = await searchParams;
  const [events, t, f] = await Promise.all([
    holeKommendeEvents(),
    getTranslations("vip"),
    getFormatter(),
  ]);

  const wahl: EventWahl[] = events
    .filter((e) => e.vip_verfuegbar)
    .map((e) => ({
      id: e.id,
      titel: e.titel,
      slug: e.slug,
      wann: f.dateTime(new Date(e.beginn), "kurz"),
    }));

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile />

      <main id="inhalt">
        <section className={css.kopfbereich} data-grund="tief">
          <div className="seitenbreite">
            <div className={css.kopfInhalt}>
              <span className="eyebrow">{t("eyebrow")}</span>
              <h1 className={css.titel}>{t("titel")}</h1>
              <p className={css.text}>{t("text")}</p>
              <ul className={css.leistungen}>
                {LEISTUNGEN.map((schluessel, i) => (
                  <li key={schluessel} className={css.leistung}>
                    <span className={css.nummer}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{t(`leistungen.${schluessel}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="abschnitt">
          <div className="seitenbreite">
            <div className={css.formbereich}>
              <header className={css.formkopf}>
                <h2>{t("formTitel")}</h2>
                <p className={css.formtext}>{t("formText")}</p>
              </header>
              <VipFormular events={wahl} vorauswahl={event} />
            </div>
          </div>
        </section>
      </main>

      <Fusszeile />
    </>
  );
}
