import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { VipSektion } from "@/components/VipSektion";
import { Ticketauswahl } from "@/components/Ticketauswahl";
import { Knopf } from "@/components/Knopf";
import { Zaehler } from "@/components/Zaehler";
import { holeEvent, holePhasen } from "@/lib/events";
import { bildUrl } from "@/lib/bilder";
import { preisText } from "@/lib/format";
import { pruefeKuerzel } from "@/lib/promoter";
import { pruefePresaleZugang } from "@/app/aktionen/bestellung";
import { versandEingerichtet } from "@/lib/mail";
import {
  einlassFlaggen,
  sichtbaresBild,
  streichpreisZu,
  verbergeSpaetePreise,
  verkaufsHinweis,
  verkaufsstartKommt,
  type VerkaufsStand,
} from "@/lib/typen";
import { Streichpreis } from "@/components/Streichpreis";
import { EventPoster } from "@/components/EventPoster";
import { Laufband } from "@/components/Laufband";
import { Eckzeichen, Kosmos, Stern, akzent } from "@/components/Deko";
import css from "./event.module.css";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ promo?: string; code?: string; einladung?: string }>;
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
      title: `${event.titel} · Lunar Events`,
      description: beschreibung,
      type: "website",
      siteName: t("titel"),
      images: (() => {
        const bild = sichtbaresBild(event);
        return bild ? [{ url: bildUrl(bild.pfad) }] : undefined;
      })(),
    },
  };
}

export default async function EventSeite({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  // Der Knopf springt auf dieselbe Seite. Ohne das Kürzel in seinem Ziel
  // fiele der Promoter-Link dabei aus der Adresse — und damit die Zuordnung.
  const suche = await searchParams;
  const promo = pruefeKuerzel(suche.promo);
  setRequestLocale(locale);

  const event = await holeEvent(slug);
  if (!event) notFound();

  const [phasen, t, tl, f] = await Promise.all([
    holePhasen(event.id),
    getTranslations("event"),
    getTranslations("laufband"),
    getFormatter(),
  ]);

  // Presale oder Verkaufsstart? Ein Code oder eine Einladung aus dem Link
  // wird gleich hier geprüft, damit die Mengenwahl ohne Flackern erscheint.
  // Nur fragen, wenn das Event überhaupt einen Verkaufsstart hat.
  const verkauf: VerkaufsStand = verkaufsstartKommt(event)
    ? await pruefePresaleZugang({
        eventId: event.id,
        code: suche.code ?? null,
        einladung: suche.einladung ?? null,
      })
    : { verkauf: "offen" };

  const beginn = new Date(event.beginn);
  const vergangen = beginn.getTime() < Date.now();
  const guenstigste = event.ab_preis_cent;
  // Spätere Phasen zeigen „???“ (18.09.2026) — ihre Preise gehen gar nicht
  // erst an den Browser.
  const phasenAnzeige = verbergeSpaetePreise(phasen);
  const streichpreis = event.streichpreis_cent ?? null;
  const streichAb = guenstigste !== null ? streichpreisZu(guenstigste, streichpreis) : null;
  const flaggen = einlassFlaggen(event);

  // Kacheln unter "Gut zu wissen". Lange Werte (Ort) nehmen die ganze Breite.
  const infos: Array<{ name: string; wert: string; breit?: boolean }> = [
    { name: t("datum"), wert: f.dateTime(beginn, "lang"), breit: true },
  ];
  if (event.einlass) {
    infos.push({
      name: t("einlass"),
      wert: f.dateTime(new Date(event.einlass), { hour: "2-digit", minute: "2-digit" }),
    });
  }
  infos.push({ name: t("beginn"), wert: f.dateTime(beginn, { hour: "2-digit", minute: "2-digit" }) });
  infos.push({
    name: t("ort"),
    wert: [event.ort.name, event.ort.strasse, `${event.ort.plz ?? ""} ${event.ort.stadt}`.trim()]
      .filter(Boolean)
      .join(", "),
    breit: true,
  });
  if (event.mindestalter) {
    infos.push({ name: t("alter"), wert: t("alterWert", { jahre: event.mindestalter }) });
  }
  if (event.dresscode) infos.push({ name: t("dresscode"), wert: event.dresscode });
  infos.push({ name: t("veranstalter"), wert: event.veranstalter, breit: true });

  const ticketsZiel = `/events/${event.slug}${promo ? `?promo=${promo}` : ""}#tickets`;
  const hinweis = vergangen ? null : verkaufsHinweis(event);
  const sticker =
    hinweis === "presale"
      ? [tl("stickerPresaleOben"), tl("stickerPresaleUnten")]
      : hinweis === "online"
        ? [tl("stickerOnlineOben"), tl("stickerOnlineUnten")]
        : hinweis === "ausverkauft"
          ? [tl("stickerAusOben"), tl("stickerAusUnten")]
          : null;
  const bild = sichtbaresBild(event);
  const tag = f.dateTime(beginn, { day: "2-digit" });
  const monat = f.dateTime(beginn, { month: "short" }).replace(".", "");

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      {!vergangen ? <Laufband events={[event]} /> : null}
      {/* "Tickets" oben springt wie der Knopf im Hero zur Ticketauswahl
          und nimmt das Promoter-Kürzel mit. */}
      <Kopfzeile ueberHero ticketZiel={ticketsZiel} />
      <Zaehler art="event_gesehen" eventId={event.id} daten={{ titel: event.titel }} />

      <main id="inhalt">
        <section className={css.hero}>
          <Stern className={`${css.stern} ${css.stern1}`} />
          <Stern className={`${css.stern} ${css.stern2}`} />

          <div className={`seitenbreite ${css.heroRaster}`}>
            <div className={css.heroInhalt}>
              <div className={css.tags}>
                <span className={css.tag}>{event.kategorie}</span>
                {flaggen.map((fl) => (
                  <span key={fl.art} className={css.tag}>
                    {t("flaggeAlter", { jahre: fl.jahre })}
                  </span>
                ))}
              </div>
              <h1 className={css.titel}>{event.titel}</h1>
              {event.untertitel ? (
                <p className={css.untertitel}>{event.untertitel}</p>
              ) : null}

              <ul className={css.eckdaten}>
                <li>
                  <Eckzeichen name="kalender" className={css.eckzeichen} />
                  {f.dateTime(beginn, "lang")}
                </li>
                <li>
                  <Eckzeichen name="uhr" className={css.eckzeichen} />
                  {event.einlass
                    ? `${t("einlass")} ${f.dateTime(new Date(event.einlass), { hour: "2-digit", minute: "2-digit" })}`
                    : `${t("beginn")} ${f.dateTime(beginn, { hour: "2-digit", minute: "2-digit" })}`}
                </li>
                <li>
                  <Eckzeichen name="ort" className={css.eckzeichen} />
                  {event.ort.name} · {event.ort.stadt}
                </li>
              </ul>

              {guenstigste !== null && !vergangen ? (
                <p className={css.preis}>
                  <span className={css.preisAb}>ab</span> {preisText(guenstigste, locale)}
                  {streichAb !== null ? (
                    <>
                      {" "}
                      <Streichpreis cent={streichAb} />
                    </>
                  ) : null}
                </p>
              ) : null}

              {!vergangen ? (
                <div className={css.heroKnopf}>
                  <Knopf href={ticketsZiel} groesse="gross" data-messen="event_tickets_kaufen">
                    <Stern className={css.knopfStern} />
                    {t("ticketsKaufen")}
                  </Knopf>
                </div>
              ) : null}
            </div>

            <div className={css.posterRahmen}>
              {bild ? (
                <Image
                  src={bildUrl(bild.pfad)}
                  alt={bild.alt ?? event.titel}
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 440px"
                  className={css.posterBild}
                  style={{ objectPosition: bild.fokus ?? "center" }}
                />
              ) : (
                <EventPoster titel={event.titel} zeile={`${event.ort.name} · ${event.ort.stadt}`} />
              )}
              <span className={css.datum} aria-hidden="true">
                <b>{tag}</b>
                <span>{monat}</span>
              </span>
              {sticker ? (
                <span className={`sticker ${css.heroSticker}`}>
                  {sticker[0]}
                  <br />
                  <b>{sticker[1]}</b>
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="abschnitt cosmos-host">
          <Kosmos teil="black-hole" bewegung="float" className={css.schwarzesLoch} />
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

                {event.lineup.length > 0 ? (
                  <div className={css.lineup}>
                    <span className="eyebrow">
                      <Stern className={css.eyebrowStern} />
                      {t("lineup")}
                    </span>
                    <ul className={css.lineupListe}>
                      {event.lineup.map((name) => (
                        <li key={name} className={css.lineupName}>
                          {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className={css.fakten} data-grund="tief">
                <h2 className={css.faktenTitel}>{t.rich("infoTitelRich", { akzent })}</h2>
                <dl className={css.infoliste}>
                  {infos.map(({ name, wert, breit }) => (
                    <div key={name} className={`${css.infozeile} ${breit ? css.infoBreit : ""}`}>
                      <dt className={css.infoName}>{name}</dt>
                      <dd className={css.infoWert}>{wert}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        <section className="abschnitt cosmos-host" data-grund="gedaempft" id="tickets">
          <Kosmos teil="orbit-ring" bewegung="spin" className={css.orbit} />
          <Kosmos teil="sparkle-pink" bewegung="twinkle" handy className={css.funkelTickets} />
          <div className="seitenbreite">
            <div className={css.abschnittKopf}>
              <span className="eyebrow">
                <Stern className={css.eyebrowStern} />
                {t("ticketsEyebrow")}
              </span>
              <h2 className={css.ticketsTitel}>{t("ticketsTitel")}</h2>
            </div>

            {vergangen ? (
              <p className={css.vergangen}>{t("vergangen")}</p>
            ) : (
              <>
                {/* Flaggen: Dinge, an denen der Einlass scheitert — ruhig, aber
                    vor der Auswahl, nicht erst in der Kasse. */}
                {flaggen.length > 0 ? (
                  <ul className={css.flaggen}>
                    {flaggen.map((fl) => (
                      <li key={fl.art} className={css.flagge}>
                        <span className={css.flaggeKurz}>{t("flaggeAlter", { jahre: fl.jahre })}</span>
                        <span>{t("flaggeHinweis", { jahre: fl.jahre })}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <Ticketauswahl
                  eventId={event.id}
                  eventSlug={event.slug}
                  eventTitel={event.titel}
                  phasen={phasenAnzeige}
                  streichpreisCent={streichpreis}
                  verkauf={verkauf}
                  warteliste={versandEingerichtet()}
                />

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
