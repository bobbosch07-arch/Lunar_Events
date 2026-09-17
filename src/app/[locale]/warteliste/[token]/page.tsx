import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { Knopf } from "@/components/Knopf";
import { WartelisteKnopf } from "@/components/WartelisteKnopf";
import { datenbankVerbunden } from "@/lib/supabase/server";
import { berlinerZeit, holeWartelisteEintrag } from "@/lib/warteliste";
import { ANGEBOT_STUNDEN } from "@/lib/typen";
import css from "../../promoter/[token]/promoter.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Warteliste",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * Ziel aller Links aus den Warteliste-Mails: bestätigen, kaufen, freigeben,
 * austragen. Was die Seite zeigt, hängt am Zustand des Eintrags — der wird
 * jedes Mal neu hergeleitet, damit ein abgelaufenes Angebot nicht mehr als
 * „Du bist dran" dasteht.
 */
export default async function WartelisteSeite({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  if (!datenbankVerbunden()) notFound();
  const eintrag = await holeWartelisteEintrag(token);
  if (!eintrag) notFound();

  const t = await getTranslations("warteliste");
  const event = eintrag.event.titel;
  const zumEvent = (
    <Link href={`/events/${eintrag.event.slug}`} className={css.abschnittText}>
      {t("zumEvent")}
    </Link>
  );

  let titel: string;
  let text: string;
  let inhalt: React.ReactNode;

  if (eintrag.event.vorbei && eintrag.zustand !== "gekauft") {
    titel = t("vorbeiTitel");
    text = event;
    inhalt = null;
  } else {
    switch (eintrag.zustand) {
      case "unbestaetigt":
        titel = t("unbestaetigtTitel");
        text = t("unbestaetigtText", { event, anzahl: eintrag.anzahl });
        inhalt = (
          <WartelisteKnopf token={token} aktion="bestaetigen" klasse={css.abschnittText} />
        );
        break;
      case "wartet":
        titel = t("wartetTitel");
        text = t("wartetText", {
          event,
          anzahl: eintrag.anzahl,
          email: eintrag.email,
          stunden: ANGEBOT_STUNDEN,
        });
        inhalt = (
          <>
            <p className={css.abschnittText}>{t("reihenfolge")}</p>
            <WartelisteKnopf
              token={token}
              aktion="austragen"
              stil="linie"
              klasse={css.abschnittText}
            />
          </>
        );
        break;
      case "angeboten":
        titel = t("angebotTitel");
        text = t("angebotText", {
          event,
          anzahl: eintrag.anzahl,
          zeit: berlinerZeit(eintrag.bestellung!.reserviertBis!, true, locale),
        });
        inhalt = (
          <>
            <div>
              <Knopf href={`/checkout?angebot=${token}`} groesse="gross">
                {t("kaufen")}
              </Knopf>
            </div>
            <WartelisteKnopf
              token={token}
              aktion="freigeben"
              stil="still"
              klasse={css.abschnittText}
            />
          </>
        );
        break;
      case "ueberweisung":
        titel = t("ueberweisungTitel");
        text = t("ueberweisungText");
        inhalt = (
          <div>
            <Knopf href={`/tickets/${eintrag.bestellung!.zugangstoken}`}>
              {t("zurBestellung")}
            </Knopf>
          </div>
        );
        break;
      case "gekauft":
        titel = t("gekauftTitel");
        text = t("gekauftText", { event });
        inhalt = (
          <div>
            <Knopf href={`/tickets/${eintrag.bestellung!.zugangstoken}`}>
              {t("ticketsOeffnen")}
            </Knopf>
          </div>
        );
        break;
      case "verfallen":
        titel = t("verfallenTitel");
        text = t("verfallenText", { event });
        inhalt = zumEvent;
        break;
      default:
        titel = t("ausgetragenTitel");
        text = t("ausgetragenText", { event });
        inhalt = zumEvent;
    }
  }

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="navy" hoehe={40} prioritaet />
          </Link>
        </div>
      </header>

      <main className={`seitenbreite ${css.inhalt}`}>
        <div className={css.kopfzeile}>
          <span className="eyebrow">{t("seite")}</span>
          <h1 className={css.titel}>{titel}</h1>
          <p className={css.intro}>{text}</p>
        </div>
        <div className={css.abschnitt}>{inhalt}</div>
      </main>
    </div>
  );
}
