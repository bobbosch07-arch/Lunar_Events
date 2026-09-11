import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { Knopf } from "@/components/Knopf";
import { TicketKarte, type TicketAnzeige } from "@/components/TicketKarte";
import { holeEigeneBestellung } from "@/app/aktionen/bestellung";
import { dienstClient } from "@/lib/supabase/server";
import { preisText } from "@/lib/format";
import css from "./bestaetigung.module.css";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ b?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "bestaetigung" });
  return { title: t("titel"), robots: { index: false, follow: false } };
}

export default async function BestaetigungsSeite({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { b } = await searchParams;
  if (!b) notFound();

  // Der Nachweis steckt im Cookie. Ohne ihn gibt es hier nichts zu sehen —
  // auch nicht mit der richtigen Bestellnummer.
  const bestellung = await holeEigeneBestellung(b);
  if (!bestellung) notFound();

  const [t, f] = await Promise.all([
    getTranslations("bestaetigung"),
    getFormatter(),
  ]);

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
    .select("code, phase_name, art, status, gast_name, platz")
    .eq("bestellung_id", b)
    .order("erstellt_am", { ascending: true });

  const versandEingerichtet = Boolean(process.env.RESEND_API_KEY);
  const walletEingerichtet = Boolean(
    process.env.APPLE_WALLET_TEAM_ID || process.env.GOOGLE_WALLET_ISSUER_ID,
  );
  const wann = f.dateTime(new Date(event.beginn), "mitZeit");
  const ort = `${event.ort.name}, ${event.ort.stadt}`;

  const tickets: TicketAnzeige[] = (rohTickets ?? []).map((z) => ({
    code: z.code as string,
    phase_name: z.phase_name as string,
    art: z.art as "standard" | "vip",
    status: z.status as TicketAnzeige["status"],
    gast_name: (z.gast_name as string | null) ?? null,
    platz: (z.platz as string | null) ?? null,
    event_titel: event.titel,
    event_wann: wann,
    event_ort: ort,
    bestellnummer: bestellung.nummer as string,
  }));

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="navy" hoehe={44} prioritaet />
          </Link>
        </div>
      </header>

      <main className={css.inhalt}>
        <div className="seitenbreite">
          <div className={css.jubel}>
            <span className="eyebrow">{f.dateTime(new Date(), "lang")}</span>
            <h1 className={css.titel}>{t("titel")}</h1>
            <p className={css.event}>{event.titel}</p>
            <p className={css.wann}>
              {wann} · {ort}
            </p>
            {/* Solange kein Mailversand eingerichtet ist, darf hier nicht
                stehen, die Tickets seien unterwegs — sie sind es nicht. */}
            {versandEingerichtet ? (
              <p className={css.mail}>{t("mailHinweis", { email: kunde.email })}</p>
            ) : (
              <p className={css.mailFehlt}>{t("mailFehltNoch")}</p>
            )}

            <dl className={css.belegdaten}>
              <div>
                <dt>{t("bestellnummer")}</dt>
                <dd className={css.tab}>{bestellung.nummer as string}</dd>
              </div>
              <div>
                <dt>Summe</dt>
                <dd className={css.tab}>
                  {preisText(bestellung.gesamt_cent as number, locale)}
                </dd>
              </div>
              <div>
                <dt>Tickets</dt>
                <dd className={css.tab}>{tickets.length}</dd>
              </div>
            </dl>
          </div>

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

          <div className={css.weiter}>
            <Knopf href="/events" stil="linie">
              Weitere Events
            </Knopf>
          </div>
        </div>
      </main>
    </div>
  );
}
