import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { Anmeldung } from "@/components/Anmeldung";
import { TicketKarte } from "@/components/TicketKarte";
import { Knopf } from "@/components/Knopf";
import { holeAngemeldeten, holeMeineTickets } from "@/lib/konto";
import css from "./tickets.module.css";

export const metadata: Metadata = {
  title: "Meine Tickets",
  robots: { index: false, follow: false },
};

export default async function MeineTickets({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [angemeldet, t, f] = await Promise.all([
    holeAngemeldeten(),
    getTranslations("ticket"),
    getFormatter(),
  ]);

  if (!angemeldet) {
    return (
      <>
        <Kopfzeile />
        <main className="abschnitt">
          <div className="seitenbreite">
            <div className={css.anmeldebereich}>
              <Anmeldung weiter="/konto/tickets" />
            </div>
          </div>
        </main>
        <Fusszeile />
      </>
    );
  }

  const tickets = await holeMeineTickets(angemeldet.id, (iso) =>
    f.dateTime(new Date(iso), "mitZeit"),
  );

  const jetzt = Date.now();
  const kommende = tickets.filter((t) => new Date(t.beginn).getTime() > jetzt);
  const vergangene = tickets.filter((t) => new Date(t.beginn).getTime() <= jetzt);

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile />

      <main id="inhalt" className="abschnitt">
        <div className="seitenbreite">
          <header className={css.kopf}>
            <span className="eyebrow">{angemeldet.email}</span>
            <h1 className={css.titel}>{t("titel")}</h1>
          </header>

          {tickets.length === 0 ? (
            <div className={css.leer}>
              <p className={css.leerText}>{t("keine")}</p>
              <Knopf href="/events">Events ansehen</Knopf>
            </div>
          ) : (
            <>
              {kommende.length > 0 ? (
                <section className={css.gruppe}>
                  <h2 className={css.gruppenTitel}>{t("kommende")}</h2>
                  <div className={css.raster}>
                    {kommende.map((ticket) => (
                      <TicketKarte key={ticket.code} ticket={ticket} />
                    ))}
                  </div>
                </section>
              ) : null}

              {vergangene.length > 0 ? (
                <section className={`${css.gruppe} ${css.vergangen}`}>
                  <h2 className={css.gruppenTitel}>{t("vergangene")}</h2>
                  <div className={css.raster}>
                    {vergangene.map((ticket) => (
                      <TicketKarte key={ticket.code} ticket={ticket} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>

      <Fusszeile />
    </>
  );
}
