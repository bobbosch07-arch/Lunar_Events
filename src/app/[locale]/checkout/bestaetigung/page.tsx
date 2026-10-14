import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { Knopf } from "@/components/Knopf";
import { Zaehler } from "@/components/Zaehler";
import { TicketKarte, type TicketAnzeige } from "@/components/TicketKarte";
import { GarderobenMarke, type MarkeAnzeige } from "@/components/GarderobenMarke";
import { UeberweisungsDaten } from "@/components/UeberweisungsDaten";
import { versandEingerichtet } from "@/lib/mail";
import {
  holeEigeneBestellung,
  stelleZahlungSicher,
} from "@/app/aktionen/bestellung";
import { dienstClient } from "@/lib/supabase/server";
import { preisText } from "@/lib/format";
import { eigeneAdresse, stripe, stripeEingerichtet } from "@/lib/stripe";
import { StripeZahlung } from "@/components/StripeZahlung";
import css from "./bestaetigung.module.css";
import { steuerhinweis } from "@/lib/steuer";
import { Kosmos } from "@/components/Deko";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ b?: string }>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const { b } = await searchParams;
  const robots = { index: false, follow: false };

  // Bei Vorkasse ist noch nichts bezahlt — "Kauf erfolgreich" im Tab wäre
  // eine Zusage, die erst der Zahlungseingang einlöst.
  const t = await getTranslations({ locale, namespace: "bestaetigung" });
  if (b) {
    // Wie die Seite selbst: erst bei Stripe nachfragen, sonst stünde im Tab
    // "nicht abgeschlossen", während die Seite schon die Tickets zeigt.
    await stelleZahlungSicher(b);
    const bestellung = await holeEigeneBestellung(b);
    if (bestellung?.status === "offen" && (bestellung as { vorkasse?: boolean }).vorkasse) {
      return { title: t("titelVorkasse"), robots };
    }
    if (bestellung && bestellung.status !== "bezahlt") return { title: t("offen.titel"), robots };
  }
  return { title: t("titel"), robots };
}

export default async function BestaetigungsSeite({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { b } = await searchParams;
  if (!b) notFound();

  // Der Gast ist oft schneller zurück als der Webhook. Bevor wir etwas
  // anzeigen, fragen wir im Zweifel selbst bei Stripe nach.
  await stelleZahlungSicher(b);

  // Der Nachweis steckt im Cookie. Ohne ihn gibt es hier nichts zu sehen —
  // auch nicht mit der richtigen Bestellnummer.
  const bestellung = await holeEigeneBestellung(b);
  if (!bestellung) notFound();

  const [t, f] = await Promise.all([
    getTranslations("bestaetigung"),
    getFormatter(),
  ]);

  // Hierher schickt Stripe nach jeder Weiterleitung zurück (PayPal, Klarna,
  // Freigabe in der Bank-App), auch wenn der Gast dort abgebrochen hat. Bis
  // 14.10.2026 stand dann trotzdem "Du bist dabei" mit 0 Tickets da, und der
  // Kauf wurde gezählt; Gäste fingen mit einer neuen Bestellung von vorn an
  // (bei THE OPENING 19 Bestellungen, alle bis zur Zahlung gekommen).
  if (bestellung.status !== "bezahlt" && !(bestellung as { vorkasse?: boolean }).vorkasse) {
    return <ZahlungOffen bestellung={bestellung} locale={locale} />;
  }

  const event = bestellung.event as unknown as {
    slug: string;
    titel: string;
    beginn: string;
    ort: { name: string; stadt: string };
  };
  const kunde = bestellung.kunde as unknown as { email: string };

  const db = dienstClient();
  const { data: rohTickets } = await db
    .from("tickets")
    .select("code, phase_name, art, status, gast_name, platz, fastlane")
    .eq("bestellung_id", b)
    .order("erstellt_am", { ascending: true })
    .order("id", { ascending: true });

  const { data: rohMarken } = await db
    .from("garderobe_marken")
    .select("code, status")
    .eq("bestellung_id", b)
    .order("erstellt_am", { ascending: true })
    .order("id", { ascending: true });
  // Frisch bezahlt ist noch nichts abgegeben: offen oder storniert.
  const marken: MarkeAnzeige[] = (rohMarken ?? []).map((m) => ({
    code: m.code as string,
    nummer: null,
    zustand: m.status === "storniert" ? "storniert" : "offen",
  }));

  const versandLaeuft = versandEingerichtet();
  const walletEingerichtet = Boolean(
    process.env.APPLE_WALLET_TEAM_ID || process.env.GOOGLE_WALLET_ISSUER_ID,
  );
  const eventId = (bestellung as unknown as { event_id?: string }).event_id ?? null;
  const ticketAdresse = `${eigeneAdresse()}/tickets/${bestellung.zugangstoken as string}`;
  // Vorkasse: bestellt, aber noch nicht bezahlt. Dann zeigt die Seite die
  // Bankverbindung statt Tickets — und zählt noch keinen Kauf.
  const wartetAufUeberweisung =
    bestellung.status === "offen" && Boolean((bestellung as { vorkasse?: boolean }).vorkasse);
  const wann = f.dateTime(new Date(event.beginn), "mitZeit");
  const ort = `${event.ort.name}, ${event.ort.stadt}`;

  const tickets: TicketAnzeige[] = (rohTickets ?? []).map((z) => ({
    code: z.code as string,
    phase_name: z.phase_name as string,
    art: z.art as "standard" | "vip",
    status: z.status as TicketAnzeige["status"],
    gast_name: (z.gast_name as string | null) ?? null,
    platz: (z.platz as string | null) ?? null,
    fastlane: Boolean(z.fastlane),
    event_titel: event.titel,
    event_wann: wann,
    event_ort: ort,
    bestellnummer: bestellung.nummer as string,
  }));

  return (
    <div className={css.rahmen}>
      {wartetAufUeberweisung ? null : <Zaehler
          art="kauf_abgeschlossen"
          eventId={eventId}
          daten={{
            titel: event.titel,
            wert: (bestellung.gesamt_cent as number) / 100,
            nummer: bestellung.nummer as string,
          }}
        />}
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="farbig" hoehe={44} prioritaet />
          </Link>
        </div>
      </header>

      <main className={`${css.inhalt} cosmos-host`}>
        <Kosmos teil="comet" bewegung="float" className={css.komet} />
        <Kosmos teil="sparkle-cluster" bewegung="twinkle" handy className={css.funkeln} />
        <div className="seitenbreite">
          <div className={css.jubel}>
            <span className="eyebrow">{f.dateTime(new Date(), "lang")}</span>
            <h1 className={css.titel}>
              {wartetAufUeberweisung ? "Fast geschafft" : t("titel")}
            </h1>
            <p className={css.event}>{event.titel}</p>
            <p className={css.wann}>
              {wann} · {ort}
            </p>
            {/* Solange kein Mailversand eingerichtet ist, darf hier nicht
                stehen, die Tickets seien unterwegs — sie sind es nicht. */}
            {versandLaeuft ? (
              <p className={css.mail}>{t("mailHinweis", { email: kunde.email })}</p>
            ) : (
              <p className={css.mailFehlt}>
                Es gibt noch keinen Mailversand. Speichere dir den Ticketlink
                unten, über ihn kommst du jederzeit an deine Tickets, auch ohne
                Konto.
              </p>
            )}

            <dl className={css.belegdaten}>
              <div>
                <dt>{t("bestellnummer")}</dt>
                <dd className={css.tab}>{bestellung.nummer as string}</dd>
              </div>
              <div>
                <dt>{t("summe")}</dt>
                <dd className={css.tab}>
                  {preisText(bestellung.gesamt_cent as number, locale)}
                </dd>
              </div>
              {(bestellung.code_rabatt_cent as number) > 0 ? (
                <div>
                  <dt>{t("rabatt")}</dt>
                  <dd className={css.tab}>
                    − {preisText(bestellung.code_rabatt_cent as number, locale)}
                  </dd>
                </div>
              ) : null}
              {/* "Tickets 0" verunsichert, solange die Überweisung aussteht —
                  die Tickets entstehen ja erst danach. */}
              {wartetAufUeberweisung ? null : (
                <div>
                  <dt>{t("tickets")}</dt>
                  <dd className={css.tab}>{tickets.length}</dd>
                </div>
              )}
            </dl>
            <p className={css.steuer}>{steuerhinweis(locale)}</p>
          </div>

          {wartetAufUeberweisung ? (
            <UeberweisungsDaten
              nummer={bestellung.nummer as string}
              betragCent={bestellung.gesamt_cent as number}
              rabattCent={((bestellung as { rabatt_cent?: number }).rabatt_cent ?? 0)}
              bis={(bestellung.reserviert_bis as string | null) ?? null}
              locale={locale}
            />
          ) : null}

          {tickets.length > 0 ? (
            <section className={css.tickets}>
              <div className={css.ticketRaster}>
                {tickets.map((ticket) => (
                  <TicketKarte key={ticket.code} ticket={ticket} />
                ))}
              </div>
              {walletEingerichtet ? (
                <p className={css.walletHinweis}>{t("walletHinweis")}</p>
              ) : null}
            </section>
          ) : null}

          {/* Garderobenmarken (0027) — gleich unter den Tickets, wie auf der
              Ticketseite. */}
          {marken.length > 0 ? (
            <section className={css.tickets}>
              <div className={css.ticketRaster}>
                {marken.map((marke, i) => (
                  <GarderobenMarke key={marke.code} marke={marke} nr={i + 1} gesamt={marken.length} />
                ))}
              </div>
            </section>
          ) : null}

          <div className={css.ticketlink}>
            <span className={css.linkLabel}>Dein dauerhafter Ticketlink</span>
            <code className={css.linkWert}>{ticketAdresse}</code>
            <p className={css.linkHinweis}>
              Speichere ihn dir. Wer den Link hat, kommt rein. Gib ihn nur an
              Leute weiter, denen du vertraust.
            </p>
          </div>

          <div className={css.weiter}>
            <Knopf href={`/tickets/${bestellung.zugangstoken as string}`}>
              Tickets öffnen
            </Knopf>
            <Knopf href="/events" stil="linie">
              Weitere Events
            </Knopf>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Zurück von Stripe, aber nicht bezahlt. Läuft die Reservierung noch, steht
 * das Zahlformular gleich wieder da, für dieselbe Bestellung: Stripe legt je
 * Bestellung nur einen Zahlvorgang an, ein zweiter Versuch bucht also nie
 * doppelt. Zustimmungen gab es schon in der Kasse. Kein Kauf wird gezählt.
 */
async function ZahlungOffen({
  bestellung,
  locale,
}: {
  bestellung: NonNullable<Awaited<ReturnType<typeof holeEigeneBestellung>>>;
  locale: string;
}) {
  const [t, f] = await Promise.all([getTranslations("bestaetigung"), getFormatter()]);
  const event = bestellung.event as unknown as { slug: string; titel: string };
  const bis = bestellung.reserviert_bis as string | null;
  const laeuft = bestellung.status === "offen" && Boolean(bis) && new Date(bis!).getTime() > Date.now();

  // Manche Zahlarten brauchen einen Moment (z. B. Lastschrift): dann nicht
  // zum zweiten Versuch auffordern.
  let inBearbeitung = false;
  if (laeuft && stripeEingerichtet()) {
    const { data } = await dienstClient()
      .from("bestellungen")
      .select("zahlung_ref")
      .eq("id", bestellung.id as string)
      .single();
    const ref = data?.zahlung_ref as string | null;
    if (ref?.startsWith("pi_")) {
      try {
        inBearbeitung = (await stripe().paymentIntents.retrieve(ref)).status === "processing";
      } catch {
        // Stripe nicht erreichbar: dann eben das Formular anbieten.
      }
    }
  }

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="farbig" hoehe={44} prioritaet />
          </Link>
        </div>
      </header>
      <main className={`${css.inhalt} cosmos-host`}>
        <div className="seitenbreite" style={{ maxWidth: 640 }}>
          <div className={css.jubel}>
            <h1 className={css.titel}>
              {inBearbeitung ? t("offen.titelBearbeitung") : t("offen.titel")}
            </h1>
            <p className={css.event}>{event.titel}</p>
            <p className={css.mail}>
              {inBearbeitung
                ? t("offen.textBearbeitung")
                : laeuft
                  ? t("offen.text", { zeit: f.dateTime(new Date(bis!), { hour: "2-digit", minute: "2-digit" }) })
                  : t("offen.textAbgelaufen")}
            </p>
          </div>
          {laeuft && !inBearbeitung && stripeEingerichtet() ? (
            <StripeZahlung
              bestellungId={bestellung.id as string}
              rueckkehr={`${eigeneAdresse()}${locale === "de" ? "" : `/${locale}`}/checkout/bestaetigung?b=${bestellung.id as string}`}
              freigegeben
            />
          ) : null}
          {!laeuft ? (
            <Knopf href={`/events/${event.slug}#tickets`} groesse="gross">
              {t("offen.neu")}
            </Knopf>
          ) : null}
        </div>
      </main>
    </div>
  );
}
