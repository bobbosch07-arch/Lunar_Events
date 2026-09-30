import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { preisText } from "@/lib/format";
import { verkaufsHinweis, type Veranstaltung } from "@/lib/typen";
import { Stern } from "./Deko";
import css from "./Laufband.module.css";

type Props = {
  /** Die kommenden Events, das nächste zuerst. */
  events: Veranstaltung[];
};

/** Mehr als drei Events machen das Band so lang, dass niemand mitliest. */
const HOECHSTENS = 3;

/**
 * Das Band ganz oben: was gerade läuft, aus den echten Eventdaten. Kein
 * freier Text, der veralten kann, und nichts, was nicht stimmt — "Presale
 * läuft" steht nur im Presale-Fenster da. Ohne kommendes Event gibt es
 * kein Band.
 *
 * Für Screenreader ist es stumm: Dieselben Angaben stehen gleich darunter
 * im Hero und auf der Eventkarte, ein endlos wiederholter Text hilft dort
 * niemandem.
 */
export async function Laufband({ events }: Props) {
  if (events.length === 0) return null;

  const t = await getTranslations("laufband");
  const f = await getFormatter();
  const locale = await getLocale();

  const punkte = events.slice(0, HOECHSTENS).flatMap((e) => {
    const beginn = new Date(e.beginn);
    const hinweis = verkaufsHinweis(e);
    const liste = [
      hinweis === "bald"
        ? t("bald", {
            datum: f.dateTime(new Date(e.verkauf_ab as string), { day: "2-digit", month: "2-digit" }),
          })
        : t(hinweis),
      `${e.titel} · ${f.dateTime(beginn, { weekday: "short", day: "2-digit", month: "2-digit" })}`,
      `${e.ort.name} ${e.ort.stadt}`,
    ];
    if (hinweis !== "ausverkauft" && e.ab_preis_cent !== null) {
      liste.push(t("abPreis", { preis: preisText(e.ab_preis_cent, locale) }));
    }
    if (e.vip_verfuegbar) liste.push(t("vipFrei"));
    return liste;
  });

  // Zweimal hintereinander, damit die Schleife nahtlos weiterläuft: Die
  // Animation schiebt genau um eine Hälfte.
  const teil = (
    <span className={css.teil}>
      {punkte.map((p, i) => (
        <span key={i} className={css.punkt}>
          {p}
          <Stern className={css.stern} />
        </span>
      ))}
    </span>
  );

  return (
    <div className={css.band} aria-hidden="true">
      <div className={css.spur}>
        {teil}
        {teil}
      </div>
    </div>
  );
}
