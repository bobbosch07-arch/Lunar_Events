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
export function UeberweisungsDaten({
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

  const frist = bis
    ? new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        weekday: "long",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(bis))
    : null;

  const zeilen: Array<[string, string, boolean?]> = [
    ["Empfänger", bank.inhaber],
    ["IBAN", bank.iban, true],
    ...(bank.bic ? ([["BIC", bank.bic, true]] as Array<[string, string, boolean]>) : []),
    ...(bank.bank ? ([["Bank", bank.bank]] as Array<[string, string]>) : []),
    ["Betrag", preisText(betragCent, locale), true],
    ["Verwendungszweck", nummer, true],
  ];

  return (
    <section className={css.block} aria-labelledby="ueberweisung-titel">
      <span className="eyebrow">Vorkasse</span>
      <h2 id="ueberweisung-titel" className={css.titel}>
        Jetzt überweisen
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
        Als Verwendungszweck <strong>nur {nummer}</strong> angeben. Sonst
        können wir die Zahlung deiner Bestellung nicht zuordnen.
      </p>

      {rabattCent > 0 ? (
        <p className={css.text}>
          Darin enthalten: {preisText(rabattCent, locale)} Vorkasse-Rabatt.
        </p>
      ) : null}

      <p className={css.text}>
        {frist ? (
          <>
            Deine Plätze sind bis <strong>{frist} Uhr</strong> reserviert. Kommt
            die Zahlung bis dahin nicht an, werden sie wieder freigegeben.{" "}
          </>
        ) : null}
        Deine Tickets erscheinen unter deinem Ticketlink, sobald die Zahlung
        eingegangen ist, meist nach ein bis zwei Werktagen.
      </p>
    </section>
  );
}
