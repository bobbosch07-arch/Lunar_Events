"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { Mengenwahl } from "./Mengenwahl";
import { StripeZahlung } from "./StripeZahlung";
import { bucheGarderobeNach } from "@/app/aktionen/bestellung";
import { preisText } from "@/lib/format";
import css from "./GarderobeNachbuchen.module.css";
import kasse from "./Checkout.module.css";

/**
 * Garderobe auf der Ticketseite nachbuchen (0027). Hell auf der dunklen
 * Ticketseite — ein kleines Kassenblatt, damit das Stripe-Formular (hell
 * gestaltet) nicht wie ein Fremdkörper wirkt.
 *
 * Erst reservieren, dann zahlen: Die Reservierung hält den Platz 15 Minuten,
 * wie in der Kasse. Nach der Zahlung schickt Stripe auf die Ticketseite
 * zurück, und dort stehen die neuen Marken.
 */
export function GarderobeNachbuchen({
  token,
  preisCent,
  max,
  rueckkehr,
}: {
  token: string;
  preisCent: number;
  /** Wie viele Stück noch gehen: zwei je Ticket minus Gebuchtes, höchstens der Rest. */
  max: number;
  rueckkehr: string;
}) {
  const t = useTranslations("garderobe");
  const locale = useLocale();
  const [offen, setOffen] = useState(false);
  const [anzahl, setAnzahl] = useState(1);
  const [zugestimmt, setZugestimmt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [stoerung, setStoerung] = useState<string | null>(null);
  const [bestellung, setBestellung] = useState<{ id: string; betrag: number } | null>(null);

  async function weiter() {
    setLaeuft(true);
    setStoerung(null);
    const ergebnis = await bucheGarderobeNach(token, anzahl);
    setLaeuft(false);
    if (ergebnis.ok) {
      setBestellung({ id: ergebnis.bestellung_id, betrag: ergebnis.betrag_cent });
      return;
    }
    setStoerung(
      ergebnis.fehler === "voll"
        ? t("nachbuchenVoll")
        : ergebnis.fehler === "menge"
          ? t("nachbuchenMenge")
          : ergebnis.fehler === "zu"
            ? t("nachbuchenZu")
            : t("nachbuchenFehler"),
    );
  }

  if (!offen) {
    return (
      <div className={css.blatt}>
        <div className={css.kopf}>
          <div>
            <h2 className={css.titel}>{t("nachbuchenTitel")}</h2>
            <p className={kasse.hinweis}>
              {t("nachbuchenText", { preis: preisText(preisCent, locale) })}
            </p>
          </div>
          <Knopf stil="linie" groesse="klein" onClick={() => setOffen(true)}>
            {t("nachbuchenTitel")}
          </Knopf>
        </div>
      </div>
    );
  }

  return (
    <div className={css.blatt}>
      <h2 className={css.titel}>{t("nachbuchenTitel")}</h2>

      {bestellung ? (
        <>
          <p className={css.betrag}>
            {t("nachbuchenBetrag", {
              anzahl,
              betrag: preisText(bestellung.betrag, locale),
            })}
          </p>
          <StripeZahlung
            bestellungId={bestellung.id}
            ticketToken={token}
            rueckkehr={rueckkehr}
            freigegeben
          />
        </>
      ) : (
        <>
          <div className={css.zeile}>
            <p className={kasse.hinweis}>
              {t("nachbuchenText", { preis: preisText(preisCent, locale) })}
            </p>
            <Mengenwahl wert={anzahl} max={max} aendern={(n) => setAnzahl(Math.max(1, n))} name={t("name")} />
          </div>

          <label className={kasse.zustimmung}>
            <input
              type="checkbox"
              checked={zugestimmt}
              onChange={(e) => setZugestimmt(e.target.checked)}
            />
            <span>
              {t.rich("nachbuchenZustimmung", {
                agb: (teil) => <Link href="/agb">{teil}</Link>,
                datenschutz: (teil) => <Link href="/datenschutz">{teil}</Link>,
              })}
            </span>
          </label>

          {stoerung ? <p className={kasse.stoerung}>{stoerung}</p> : null}

          <div className={kasse.knoepfe}>
            <Knopf onClick={weiter} disabled={!zugestimmt || laeuft}>
              {laeuft
                ? "…"
                : `${t("nachbuchenKnopf")} · ${preisText(preisCent * anzahl, locale)}`}
            </Knopf>
            <Knopf stil="linie" onClick={() => setOffen(false)} disabled={laeuft}>
              {t("nachbuchenAbbrechen")}
            </Knopf>
          </div>
        </>
      )}
    </div>
  );
}
