import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import {
  Textseite,
  Block,
  Absatz,
  Liste,
  Angaben,
  Luecke,
} from "@/components/Textseite";

export const metadata: Metadata = {
  title: "Datenschutz",
  robots: { index: true, follow: false },
};

/**
 * Diese Seite beschreibt, was die Anwendung tatsächlich tut — abgeleitet
 * aus dem Code, nicht aus einer Vorlage. Die juristische Einordnung muss
 * trotzdem geprüft werden.
 */
export default async function Datenschutz({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite
      titel="Datenschutz"
      vorspann="Was wir speichern, warum, und wie lange."
      warnung={{
        titel: "Vor Veröffentlichung prüfen lassen",
        text: "Der technische Teil beschreibt, was die Anwendung wirklich tut. Die juristischen Formulierungen und Fristen gehören vor dem Start auf den Tisch einer Datenschutzberatung — besonders die Aufbewahrungsfristen und die Auftragsverarbeitungsverträge.",
      }}
      stand="Stand: September 2026. Wird angepasst, sobald sich die eingesetzten Dienste ändern."
    >
      <Block titel="Verantwortlich">
        <Absatz>
          Nicklas Reyes Kretschmar, Kranichsteiner-Straße 27, 64390
          Erzhausen. Bei Fragen zum Datenschutz:{" "}
          <a href="mailto:lunar.eventsss.de@gmail.com">
            lunar.eventsss.de@gmail.com
          </a>
          .
        </Absatz>
      </Block>

      <Block titel="Wenn du nur die Seite ansiehst">
        <Absatz>
          Beim Aufruf überträgt dein Browser die üblichen technischen Daten
          (IP-Adresse, Zeitpunkt, aufgerufene Adresse, Browserkennung). Unser
          Hoster verarbeitet sie, um die Seite auszuliefern und Angriffe
          abzuwehren. Rechtsgrundlage ist unser berechtigtes Interesse an einem
          funktionierenden Angebot (Art. 6 Abs. 1 lit. f DSGVO).
        </Absatz>
        <Absatz>
          <strong>Die Schriften liegen auf unserem eigenen Server.</strong> Beim
          Betrachten der Seite entsteht keine Verbindung zu Google Fonts oder
          einem anderen Schriftanbieter. Es gibt auf diesen Seiten auch keine
          Analyse-Werkzeuge, keine Werbenetzwerke und keine Einbettungen von
          sozialen Netzwerken.
        </Absatz>
      </Block>

      <Block titel="Wenn du Tickets kaufst">
        <Absatz>
          Für die Bestellung brauchen wir Vor- und Nachname sowie deine
          E-Mail-Adresse; die Telefonnummer ist freiwillig. Dazu speichern wir,
          welches Event und welche Tickets du gekauft hast, den Betrag und den
          Zeitpunkt. Rechtsgrundlage ist die Erfüllung des Vertrags
          (Art. 6 Abs. 1 lit. b DSGVO).
        </Absatz>
        <Absatz>
          Die Zahlung selbst wickeln wir über Zahlungsdienstleister ab. Deine
          Kartendaten erreichen unseren Server nie — sie werden direkt an den
          Dienstleister übertragen. Wir erfahren nur, ob gezahlt wurde, und
          erhalten eine Vorgangsnummer für den Abgleich.
        </Absatz>
        <Absatz>
          Kaufbelege und Bestelldaten unterliegen steuerlichen und
          handelsrechtlichen Aufbewahrungspflichten und werden entsprechend
          lange aufbewahrt, auch wenn du kein Konto mehr hast.
        </Absatz>
      </Block>

      <Block titel="Wenn du VIP anfragst">
        <Absatz>
          Wir speichern deine Angaben aus dem Anfrageformular, um dir ein
          Angebot machen zu können (Art. 6 Abs. 1 lit. b DSGVO). Kommt kein
          Vertrag zustande, löschen wir die Anfrage, sobald sie erledigt ist,
          spätestens nach <Luecke>Frist festlegen</Luecke>.
        </Absatz>
      </Block>

      <Block titel="Am Einlass">
        <Absatz>
          Wird dein Ticket gescannt, merken wir uns Zeitpunkt der Entwertung
          und welches Gerät gescannt hat. Das verhindert, dass ein Ticket
          mehrfach benutzt wird.
        </Absatz>
      </Block>

      <Block titel="Wer die Daten in unserem Auftrag verarbeitet">
        <Angaben
          zeilen={[
            [
              "Datenbank",
              "Supabase (Postgres), Server in Frankfurt am Main. Hier liegen Bestellungen, Tickets und Kontodaten.",
            ],
            [
              "Hosting",
              "Vercel — liefert die Seiten aus und schreibt technische Protokolle.",
            ],
            [
              "Zahlungen",
              "Stripe für Karten- und SEPA-Zahlungen; PayPal, sobald eingerichtet. Beide sind eigenständig Verantwortliche für ihre Zahlungsdaten.",
            ],
          ]}
        />
        <Absatz>
          Mit diesen Anbietern sind Verträge zur Auftragsverarbeitung
          abzuschließen — <Luecke>Abschluss dokumentieren</Luecke>. Wo Daten in
          Drittländer gelangen können, stützen wir uns auf die
          Standardvertragsklauseln der EU-Kommission.
        </Absatz>
      </Block>

      <Block titel="Cookies">
        <Absatz>
          Wir setzen nur Cookies, ohne die die Seite nicht funktionieren würde:
        </Absatz>
        <Liste
          punkte={[
            "Ein Cookie hält während des Kaufs fest, welche Bestellung dir gehört — sonst kämst du nach dem Bezahlen nicht an deine eigenen Tickets. Es läuft nach vier Stunden ab.",
            "Ein Cookie merkt sich deine Sprachwahl.",
            "Bist du angemeldet, hält ein Cookie deine Sitzung.",
            "Zahlungsdienstleister setzen eigene Cookies zur Betrugserkennung.",
          ]}
        />
        <Absatz>
          Für technisch notwendige Cookies ist keine Einwilligung erforderlich.
          Sobald Reichweitenmessung oder Kampagnen-Auswertung hinzukommen,
          braucht es einen Einwilligungsdialog — <Luecke>dann ergänzen</Luecke>.
        </Absatz>
      </Block>

      <Block titel="Deine Rechte">
        <Liste
          punkte={[
            "Auskunft darüber, welche Daten wir zu dir gespeichert haben (Art. 15 DSGVO)",
            "Berichtigung falscher Angaben (Art. 16)",
            "Löschung, soweit keine Aufbewahrungspflicht entgegensteht (Art. 17)",
            "Einschränkung der Verarbeitung (Art. 18)",
            "Herausgabe deiner Daten in einem gängigen Format (Art. 20)",
            "Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen (Art. 21)",
            "Beschwerde bei einer Aufsichtsbehörde (Art. 77)",
          ]}
        />
        <Absatz>
          Eine Nachricht an die oben genannte Adresse genügt. Wir antworten
          innerhalb eines Monats.
        </Absatz>
      </Block>
    </Textseite>
  );
}
