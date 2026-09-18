import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { Knopf } from "@/components/Knopf";
import { TuerZahlung } from "@/components/TuerZahlung";
import { stelleZahlungSicher } from "@/app/aktionen/bestellung";
import { preisText } from "@/lib/format";
import { eigeneAdresse, stripeEingerichtet } from "@/lib/stripe";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import css from "@/components/Checkout.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Abendkasse",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * Hier landet der Gast, wenn er an der Abendkasse den QR-Code scannt
 * (0025). Kein Konto, kein Cookie: Der Link ist der Nachweis — und er gilt
 * nur für Bestellungen, die an der Kasse entstanden sind.
 *
 * Nach der Zahlung schickt Stripe hierher zurück; die Seite zeigt dann
 * „Bezahlt", und die Kasse springt von selbst um.
 */
export default async function TuerZahlen({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  if (!datenbankVerbunden() || !/^[0-9a-f]{64}$/.test(token)) notFound();

  const db = dienstClient();
  const lies = async () =>
    (
      await db
        .from("bestellungen")
        .select(
          `id, nummer, status, gesamt_cent, reserviert_bis, abendkasse, zugangstoken,
           event:events(titel)`,
        )
        .eq("zugangstoken", token)
        .maybeSingle()
    ).data;

  let bestellung = await lies();
  if (!bestellung?.abendkasse) notFound();

  // Stripe schickt den Gast oft schneller zurück, als der Webhook kommt.
  if (bestellung.status === "offen") {
    await stelleZahlungSicher(bestellung.id as string);
    bestellung = (await lies()) ?? bestellung;
  }

  const t = await getTranslations("tuer");
  const event = bestellung.event as unknown as { titel: string } | null;
  const abgelaufen =
    bestellung.status !== "bezahlt" &&
    (bestellung.status !== "offen" ||
      (bestellung.reserviert_bis &&
        new Date(bestellung.reserviert_bis as string).getTime() < Date.now()));

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
        <div className="seitenbreite" style={{ maxWidth: 560 }}>
          <p className={css.hinweis}>{event?.titel}</p>

          {bestellung.status === "bezahlt" ? (
            <>
              <h1 className={css.titel}>{t("bezahlt")}</h1>
              <p className={css.hinweis}>{t("bezahltText")}</p>
              <div className={css.knoepfe}>
                <Knopf href={`/tickets/${bestellung.zugangstoken as string}`} stil="linie">
                  {t("tickets")}
                </Knopf>
              </div>
            </>
          ) : abgelaufen ? (
            <>
              <h1 className={css.titel}>{t("abgelaufen")}</h1>
              <p className={css.hinweis}>{t("abgelaufenText")}</p>
            </>
          ) : !stripeEingerichtet() ? (
            <>
              <h1 className={css.titel}>{t("abgelaufen")}</h1>
              <p className={css.hinweis}>{t("keineKarte")}</p>
            </>
          ) : (
            <>
              <h1 className={css.titel}>
                {preisText(bestellung.gesamt_cent as number, locale)}
              </h1>
              <p className={css.hinweis}>
                {t("text", { nummer: bestellung.nummer as string })}
              </p>
              <TuerZahlung
                bestellungId={bestellung.id as string}
                token={token}
                rueckkehr={`${eigeneAdresse()}/kasse/zahlen/${token}`}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
