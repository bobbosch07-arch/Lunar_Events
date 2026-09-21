import { getTranslations } from "next-intl/server";
import { bankdaten } from "@/lib/vorkasse";
import { preisText } from "@/lib/format";
import css from "./Ueberweisung.module.css";

/**
 * Was der Gast für die Überweisung braucht — auf der Bestätigungsseite
 * und unter dem Ticketlink.
 *
 * Solange es keinen Mailversand gibt, sind das die einzigen beiden
 * Stellen, an denen die Bankverbindung steht. Deshalb vollständig und
 * zum Abschreiben gesetzt: IBAN in Viererblöcken, der Verwendungszweck
 * hervorgehoben — ohne ihn lässt sich eine Zahlung keiner Bestellung
 * zuordnen.
 */
export async function UeberweisungsDaten({
  nummer,
  betragCent,
  rabattCent,
  bis,
  locale,
}: {
  nummer: string;
  betragCent: number;
  rabattCent: number;
  bis: string | null;
  locale: string;
}) {
  const bank = bankdaten();
  if (!bank) return null;
  const t = await getTranslations("ueberweisung");

  const frist = bis
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
        timeZone: "Europe/Berlin",
        weekday: "long",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(bis))
    : null;

  const zeilen: Array<[string, string, boolean?]> = [
    [t("empfaenger"), bank.inhaber],
    ["IBAN", bank.iban, true],
    ...(bank.bic ? ([["BIC", bank.bic, true]] as Array<[string, string, boolean]>) : []),
    ...(bank.bank ? ([[t("bank"), bank.bank]] as Array<[string, string]>) : []),
    [t("betrag"), preisText(betragCent, locale), true],
    [t("verwendungszweck"), nummer, true],
  ];

  return (
    <section className={css.block} aria-labelledby="ueberweisung-titel">
      <span className="eyebrow">{t("vorkasse")}</span>
      <h2 id="ueberweisung-titel" className={css.titel}>
        {t("jetztUeberweisen")}
      </h2>

      <dl className={css.liste}>
        {zeilen.map(([name, wert, fest]) => (
          <div key={name} className={css.zeile}>
            <dt className={css.name}>{name}</dt>
            <dd className={`${css.wert} ${fest ? css.fest : ""}`}>{wert}</dd>
          </div>
        ))}
      </dl>

      <p className={css.wichtig}>
        {t.rich("verwendungHinweis", { nummer, b: (c) => <strong>{c}</strong> })}
      </p>

      {rabattCent > 0 ? (
        <p className={css.text}>
          {t("rabattEnthalten", { betrag: preisText(rabattCent, locale) })}
        </p>
      ) : null}

      <p className={css.text}>
        {frist
          ? t.rich("fristHinweis", { frist, b: (c) => <strong>{c}</strong> })
          : null}
        {t("ticketsHinweis")}
      </p>
    </section>
  );
}
