import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { CheckoutFluss, type Posten } from "@/components/CheckoutFluss";
import { holeEvent, holePhasen } from "@/lib/events";
import { phasenZustand } from "@/lib/typen";
import css from "@/components/Checkout.module.css";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ event?: string; p?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  // Eine Kasse gehört nicht in Suchergebnisse.
  return { title: t("titel"), robots: { index: false, follow: false } };
}

/** "phaseId:menge,phaseId:menge" → Liste. Unsinn wird still verworfen. */
function leseAuswahl(roh: string | undefined): Map<string, number> {
  const karte = new Map<string, number>();
  if (!roh) return karte;
  for (const teil of roh.split(",")) {
    const [id, menge] = teil.split(":");
    const zahl = Number(menge);
    if (id && Number.isInteger(zahl) && zahl > 0 && zahl <= 10) {
      karte.set(id, zahl);
    }
  }
  return karte;
}

export default async function CheckoutSeite({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { event: slug, p } = await searchParams;
  if (!slug) notFound();

  const event = await holeEvent(slug);
  if (!event || event.status !== "veroeffentlicht") notFound();

  const [phasen, t, f] = await Promise.all([
    holePhasen(event.id),
    getTranslations("checkout"),
    getFormatter(),
  ]);

  const gewaehlt = leseAuswahl(p);

  // Die Auswahl aus der Adresse wird gegen die Wirklichkeit geprüft: Preise
  // kommen aus der Datenbank, nicht aus der URL, und was inzwischen
  // ausverkauft ist, fällt heraus.
  const posten: Posten[] = [];
  for (const phase of phasen) {
    const menge = gewaehlt.get(phase.id);
    if (!menge) continue;
    const zustand = phasenZustand(phase);
    if (zustand.art !== "kaufbar") continue;
    posten.push({
      phase_id: phase.id,
      phase_name: phase.name,
      menge: zustand.rest !== null ? Math.min(menge, zustand.rest) : menge,
      einzelpreis_cent: phase.preis_cent,
      gebuehr_cent: phase.gebuehr_cent,
    });
  }

  // Ohne gültige Auswahl gibt es nichts zu bezahlen — zurück zum Event,
  // statt eine leere Kasse zu zeigen.
  if (posten.length === 0) redirect(`/events/${event.slug}#tickets`);

  const testmodus =
    !process.env.STRIPE_SECRET_KEY && !process.env.PAYPAL_CLIENT_SECRET;

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <div className={css.kopfReihe}>
            <Link href="/" aria-label="Lunar Events">
              <Logo ton="navy" hoehe={44} prioritaet />
            </Link>
            <span className={css.sicher}>{t("titel")}</span>
          </div>
        </div>
      </header>

      <main className={css.inhalt}>
        <div className="seitenbreite">
          <CheckoutFluss
            eventId={event.id}
            eventSlug={event.slug}
            eventTitel={event.titel}
            eventWann={f.dateTime(new Date(event.beginn), "mitZeit")}
            eventOrt={`${event.ort.name}, ${event.ort.stadt}`}
            posten={posten}
            testmodus={testmodus}
          />
        </div>
      </main>
    </div>
  );
}
