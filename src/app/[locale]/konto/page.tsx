import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Kopfzeile } from "@/components/Kopfzeile";
import { Fusszeile } from "@/components/Fusszeile";
import { Anmeldung } from "@/components/Anmeldung";
import { Knopf } from "@/components/Knopf";
import { holeAngemeldeten } from "@/lib/konto";
import { serverClient } from "@/lib/supabase/server";
import { meldeAb } from "@/app/aktionen/konto";
import css from "./konto.module.css";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function Konto({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ fehler?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { fehler } = await searchParams;
  const [angemeldet, t] = await Promise.all([
    holeAngemeldeten(),
    getTranslations("konto"),
  ]);

  let team = false;
  if (angemeldet) {
    const db = await serverClient();
    const { data: m } = await db
      .from("mitarbeiter")
      .select("rolle, aktiv")
      .eq("user_id", angemeldet.id)
      .maybeSingle();
    team = Boolean(m?.aktiv && (m.rolle === "admin" || m.rolle === "team"));
  }

  return (
    <>
      <a href="#inhalt" className="sprunglink">
        Zum Inhalt springen
      </a>
      <Kopfzeile />

      <main id="inhalt" className="abschnitt">
        <div className="seitenbreite">
          {angemeldet ? (
            <div className={css.uebersicht}>
              <header className={css.kopf}>
                <span className="eyebrow">{t("uebersicht")}</span>
                <h1 className={css.titel}>{t("titel")}</h1>
                <p className={css.adresse}>{angemeldet.email}</p>
              </header>

              <div className={css.kacheln}>
                {team ? (
                  <article className={css.kachel}>
                    <h2 className={css.kachelTitel}>Backoffice</h2>
                    <p className={css.kachelText}>
                      Events, Bestellungen, VIP-Anfragen und Zahlungen —
                      dieses Konto gehört zum Team.
                    </p>
                    <Knopf href="/backoffice">Zum Backoffice</Knopf>
                  </article>
                ) : null}
                <article className={css.kachel}>
                  <h2 className={css.kachelTitel}>{t("meineTickets")}</h2>
                  <p className={css.kachelText}>
                    Alle Tickets, die an diese Adresse gegangen sind — auch die
                    aus Käufen ohne Konto.
                  </p>
                  <Knopf href="/konto/tickets">{t("meineTickets")}</Knopf>
                </article>

                <article className={css.kachel}>
                  <h2 className={css.kachelTitel}>Nächste Events</h2>
                  <p className={css.kachelText}>
                    Was als Nächstes ansteht und wo es noch Tickets gibt.
                  </p>
                  <Knopf href="/events" stil="linie">
                    Events ansehen
                  </Knopf>
                </article>
              </div>

              <form action={meldeAb} className={css.abmelden}>
                <button type="submit" className={css.abmeldenKnopf}>
                  {t("abmelden")}
                </button>
              </form>
            </div>
          ) : (
            <div className={css.anmeldebereich}>
              {fehler ? (
                <p className={css.stoerung}>
                  {fehler === "abgelaufen"
                    ? "Der Anmeldelink ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an."
                    : "Der Anmeldelink war unvollständig. Fordere einen neuen an."}
                </p>
              ) : null}
              <Anmeldung weiter="/konto/tickets" />
            </div>
          )}
        </div>
      </main>

      <Fusszeile />
    </>
  );
}
