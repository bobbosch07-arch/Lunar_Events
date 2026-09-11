import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { EventKarte } from "@/components/EventKarte";
import { EventFilter } from "@/components/EventFilter";
import { holeKommendeEvents } from "@/lib/events";
import css from "./liste.module.css";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ k?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "events" });
  return { title: t("titel") };
}

export default async function EventListe({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { k } = await searchParams;
  const t = await getTranslations("events");
  const alle = await holeKommendeEvents();

  // Nur Kategorien anbieten, zu denen es auch etwas gibt — ein Filter,
  // der auf eine leere Liste führt, ist kein Filter, sondern eine Falle.
  const kategorien = [...new Set(alle.map((e) => e.kategorie))];
  const gewaehlt = k && kategorien.includes(k as never) ? k : null;
  const sichtbar = gewaehlt ? alle.filter((e) => e.kategorie === gewaehlt) : alle;

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile />

      <main id="inhalt" className="abschnitt">
        <div className="seitenbreite">
          <header className={css.kopf}>
            <span className="eyebrow">{t("eyebrow")}</span>
            <h1>{t("titel")}</h1>
            <p className={css.anzahl}>{t("anzahl", { anzahl: sichtbar.length })}</p>
          </header>

          {kategorien.length > 1 ? (
            <EventFilter kategorien={kategorien} gewaehlt={gewaehlt} />
          ) : null}

          {sichtbar.length > 0 ? (
            <div className={css.raster}>
              {sichtbar.map((e, i) => (
                <EventKarte key={e.id} event={e} prioritaet={i < 3} />
              ))}
            </div>
          ) : (
            <p className={css.leer}>{t("leer")}</p>
          )}
        </div>
      </main>

      <Fusszeile />
    </>
  );
}
