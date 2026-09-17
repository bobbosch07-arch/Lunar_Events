import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { Knopf } from "@/components/Knopf";
import { Link } from "@/i18n/navigation";
import { holePromoterListe } from "@/lib/backoffice";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Promoter",
  robots: { index: false, follow: false },
};

export default async function PromoterListe({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Promoter">
        <Knopf href="/backoffice/promoter/neu" groesse="klein">
          Promoter anlegen
        </Knopf>
      </BackofficeKopf>
      <Suspense fallback={<BackofficeSkelett zeilen={6} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

async function Inhalt() {
  const promoter = await holePromoterListe();

  return (
    <>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Promoter</th>
              <th>Kürzel</th>
              <th>Codes</th>
              <th className={css.zahl}>Klicks</th>
              <th className={css.zahl}>Tickets</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {promoter.length === 0 ? (
              <tr>
                <td colSpan={6} className={css.leer}>
                  Noch keine Promoter.
                </td>
              </tr>
            ) : (
              promoter.map((p) => (
                <tr key={p.id}>
                  <td className={css.haupt}>
                    <Link href={`/backoffice/promoter/${p.id}`}>{p.name}</Link>
                    {p.notiz ? <div className={css.nebensache}>{p.notiz}</div> : null}
                  </td>
                  <td className={css.nebensache}>{p.kuerzel}</td>
                  <td>
                    {p.codes.length === 0 ? (
                      <span className={css.nebensache}>kein Rabatt</span>
                    ) : (
                      p.codes.map((c) => (
                        <div key={c.id}>
                          <Link href={`/backoffice/rabattcodes/${c.id}`}>{c.code}</Link>
                        </div>
                      ))
                    )}
                  </td>
                  <td className={css.zahl}>{p.klicks}</td>
                  <td className={css.zahl}>{p.tickets}</td>
                  <td>
                    <span className={`${css.marke_} ${p.aktiv ? css.gut : css.neutral}`}>
                      {p.aktiv ? "aktiv" : "pausiert"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        Klicks sind Aufrufe einer Eventseite über den Link des Promoters — keine
        Personen: Wer zweimal öffnet, zählt zweimal. Tickets zählen erst, wenn sie
        bezahlt sind, und kommen über den Link oder einen Code des Promoters. Nutzt
        jemand den Code eines anderen Promoters, zählt der Code.
      </p>
    </>
  );
}
