import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { VipSektion } from "@/components/VipSektion";
import { Ticketauswahl } from "@/components/Ticketauswahl";
import { Knopf } from "@/components/Knopf";
import { holeEvent, holePhasen } from "@/lib/events";
import { bildUrl } from "@/lib/bilder";
import { preisText } from "@/lib/format";
import css from "./event.module.css";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const event = await holeEvent(slug);
  if (!event) return {};

  const t = await getTranslations({ locale, namespace: "meta" });
  const f = await getFormatter({ locale });
  const wann = f.dateTime(new Date(event.beginn), "lang");
  const beschreibung =
    event.teaser ?? `${wann} · ${event.ort.name}, ${event.ort.stadt}`;

  return {
    title: event.titel,
    description: beschreibung,
    openGraph: {
      title: `${event.titel} — Lunar Events`,
      description: beschreibung,
      type: "website",
      siteName: t("titel"),
      images: event.bild ? [{ url: bildUrl(event.bild.pfad) }] : undefined,
    },
  };
}

export default async function EventSeite({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const event = await holeEvent(slug);
  if (!event) notFound();

  const [phasen, t, f] = await Promise.all([
    holePhasen(event.id),
    getTranslations("event"),
    getFormatter(),
  ]);

  const beginn = new Date(event.beginn);
  const vergangen = beginn.getTime() < Date.now();
  const guenstigste = event.ab_preis_cent;

  const infos: Array<[string, string]> = [
    [t("datum"), f.dateTime(beginn, "lang")],
    [t("beginn"), f.dateTime(beginn, { hour: "2-digit", minute: "2-digit" })],
  ];
  if (event.einlass) {
    infos.splice(1, 0, [
      t("einlass"),
      f.dateTime(new Date(event.einlass), { hour: "2-digit", minute: "2-digit" }),
    ]);
  }
  infos.push([
    t("ort"),
    [event.ort.name, event.ort.strasse, `${event.ort.plz ?? ""} ${event.ort.stadt}`.trim()]
      .filter(Boolean)
      .join(", "),
  ]);
  if (event.mindestalter) {
    infos.push([t("alter"), t("alterWert", { jahre: event.mindestalter })]);
  }
  if (event.dresscode) infos.push([t("dresscode"), event.dresscode]);
  infos.push([t("veranstalter"), event.veranstalter]);

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile ueberHero />

      <main id="inhalt">
        <section className={css.hero} data-grund="tief">
          {event.bild ? (
            <Image
              src={bildUrl(event.bild.pfad)}
              alt={event.bild.alt ?? event.titel}
              fill
              priority
              sizes="100vw"
              className={css.heroBild}
              style={{ objectPosition: event.bild.fokus ?? "center" }}
            />
          ) : (
            <div className={css.heroGrund} aria-hidden="true" />
          )}
          <div className={css.heroSchleier} aria-hidden="true" />

          <div className={`seitenbreite ${css.heroInhalt}`}>
            <span className="eyebrow">{event.kategorie}</span>
            <h1 className={css.titel}>{event.titel}</h1>
            {event.untertitel ? (
              <p className={css.untertitel}>{event.untertitel}</p>
            ) : null}

            <div className={css.eckdaten}>
              <span className={css.eckpunkt}>{f.dateTime(beginn, "lang")}</span>
              <span className={css.eckTrenner} aria-hidden="true" />
              <span className={css.eckpunkt}>
                {event.ort.name} · {event.ort.stadt}
              </span>
              {guenstigste !== null && !vergangen ? (
                <>
                  <span className={css.eckTrenner} aria-hidden="true" />
                  <span className={css.eckpunkt}>
                    ab {preisText(guenstigste, locale)}
                  </span>
                </>
              ) : null}
            </div>

            {!vergangen ? (
              <div className={css.heroKnopf}>
                <Knopf href={`/events/${event.slug}#tickets`} stil="hell" groesse="gross">
                  {t("ticketsKaufen")}
                </Knopf>
              </div>
            ) : null}
          </div>
        </section>

        <section className="abschnitt">
          <div className="seitenbreite">
            <div className={css.spalten}>
              <div className={css.text}>
                {event.beschreibung
                  ? event.beschreibung.split("\n\n").map((absatz, i) => (
                      <p key={i} className={css.absatz}>
                        {absatz}
                      </p>
                    ))
                  : null}
              </div>

              <div>
                <div className={css.abschnittKopf}>
                  <span className="eyebrow">{t("infoTitel")}</span>
                </div>
                <dl className={css.infoliste}>
                  {infos.map(([name, wert]) => (
                    <div key={name} className={css.infozeile}>
                      <dt className={css.infoName}>{name}</dt>
                      <dd className={css.infoWert}>{wert}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        <section className="abschnitt" data-grund="gedaempft" id="tickets">
          <div className="seitenbreite">
            <div className={css.abschnittKopf}>
              <span className="eyebrow">{t("ticketsEyebrow")}</span>
              <h2>{t("ticketsTitel")}</h2>
            </div>

            {vergangen ? (
              <p className={css.vergangen}>{t("vergangen")}</p>
            ) : (
              <>
                <Ticketauswahl eventSlug={event.slug} phasen={phasen} />

                <div className={css.abendkasse}>
                  {event.abendkasse ? (
                    <>
                      <div className={css.akSpalte}>
                        <span className={css.akLabel}>{t("abendkasseOnline")}</span>
                        <span className={css.akWert}>
                          {guenstigste !== null ? preisText(guenstigste, locale) : "—"}
                        </span>
                      </div>
                      <div className={css.akTrenner} aria-hidden="true" />
                      <div className={css.akSpalte}>
                        <span className={css.akLabel}>{t("abendkasseTitel")}</span>
                        <span className={`${css.akWert} ${css.akWeich}`}>
                          {event.abendkasse_hinweis ?? t("abendkasseHinweis")}
                        </span>
                      </div>
                      <p className={css.akFuss}>{t("abendkasseText")}</p>
                    </>
                  ) : (
                    <p className={css.akFuss}>{t("abendkasseKeine")}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {event.vip_verfuegbar && !vergangen ? (
          <section className="abschnitt">
            <div className="seitenbreite">
              <VipSektion eventSlug={event.slug} />
            </div>
          </section>
        ) : null}
      </main>

      <Fusszeile />
    </>
  );
}
