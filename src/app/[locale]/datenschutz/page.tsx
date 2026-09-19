import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import {
  Textseite,
  Block,
  Absatz,
  Liste,
  Angaben,
} from "@/components/Textseite";

export const metadata: Metadata = {
  title: "Datenschutz",
  robots: { index: true, follow: false },
};

/**
 * Diese Seite beschreibt, was die Anwendung tatsächlich tut, abgeleitet aus
 * dem Code und der Infrastruktur (Stand 19.09.2026), nicht aus einer
 * Vorlage. Wer einen Dienst, eine Frist oder einen Ablauf ändert, ändert
 * diese Seite mit. Die Löschfristen setzt `loesche_alte_daten()` (0032) um.
 * Juristisch geprüft ist sie noch nicht (Roadmap E13).
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
      vorspann="Was wir speichern, warum, wo und wie lange."
      stand="Stand: 19. September 2026. Wir passen die Erklärung an, sobald sich Dienste oder Abläufe ändern."
    >
      <Block titel="1. Verantwortlich">
        <Absatz>
          Niklas Reyes Kretschmar, handelnd als Lunar Events,
          Kranichsteiner-Straße 27, 64390 Erzhausen. E-Mail:{" "}
          <a href="mailto:kontakt@lunar-events.de">kontakt@lunar-events.de</a>.
          Einen Datenschutzbeauftragten müssen wir nicht benennen. Für alle
          Fragen zum Datenschutz genügt eine Mail an diese Adresse.
        </Absatz>
      </Block>

      <Block titel="2. Das Wichtigste in Kürze">
        <Liste
          punkte={[
            "Wir speichern nur, was wir für Verkauf, Einlass und Kontakt brauchen.",
            "Keine Analyse-Werkzeuge, keine Werbe-Pixel, keine Tracking-Cookies, keine Einbettungen sozialer Netzwerke.",
            "Unsere Server stehen in Frankfurt am Main. Einige Anbieter haben ihren Sitz in den USA. Wo das so ist, steht es unten dabei.",
            "Kartendaten sehen wir nie. Die gibst du direkt bei Stripe ein.",
          ]}
        />
      </Block>

      <Block titel="3. Wenn du die Seite aufrufst">
        <Absatz>
          Dein Browser überträgt bei jedem Aufruf technische Daten: IP-Adresse,
          Datum und Uhrzeit, die aufgerufene Adresse, die Seite, von der du
          kommst, sowie Browser und Betriebssystem. Unser Hoster Vercel
          verarbeitet diese Daten, um die Seite auszuliefern, Fehler zu finden
          und Angriffe abzuwehren. Die Protokolle bewahrt Vercel nur kurz auf.
          Rechtsgrundlage ist unser berechtigtes Interesse an einem
          sicheren und funktionierenden Angebot (Art. 6 Abs. 1 lit. f DSGVO).
        </Absatz>
        <Absatz>
          Schutz vor Missbrauch: Damit niemand mit einem Skript alle Tickets
          reserviert, Codes durchprobiert oder massenhaft Mails auslöst, zählen
          wir bei Reservierungen, Anmeldungen und Formularen, wie oft sie von
          einem Anschluss kommen. Dafür speichern wir nicht die IP-Adresse,
          sondern einen verschlüsselten Prüfwert, aus dem sie sich nicht
          zurückrechnen lässt. Er wird nach einem Tag automatisch gelöscht
          (Art. 6 Abs. 1 lit. f DSGVO).
        </Absatz>
        <Absatz>
          Reichweite zählen wir ohne Personenbezug: Wir speichern nur, welche
          Seite aufgerufen wurde, gerundet auf die Stunde. Keine IP-Adresse,
          keine Kennung, kein Cookie. Einen Rückschluss auf dich erlaubt das
          nicht.
        </Absatz>
        <Absatz>
          Die Schriften liegen auf unserem eigenen Server. Beim Aufruf entsteht
          keine Verbindung zu Google Fonts oder anderen Schriftanbietern.
        </Absatz>
      </Block>

      <Block titel="4. Wenn du Tickets kaufst">
        <Absatz>
          Für die Bestellung brauchen wir Vorname, Nachname und E-Mail-Adresse.
          Die Telefonnummer ist freiwillig. Dazu speichern wir Event, Tickets,
          Extras wie Fast Lane oder Garderobe, Betrag, Zahlungsart, einen
          eingelösten Rabattcode, den Promoter, über dessen Link du gekommen
          bist, und den Zeitpunkt. Ohne diese Angaben können wir dir keine
          Tickets verkaufen. Rechtsgrundlage ist der Vertrag
          (Art. 6 Abs. 1 lit. b DSGVO).
        </Absatz>
        <Absatz>
          Die Tickets schicken wir dir per E-Mail und zeigen sie auf einer
          eigenen Ticketseite. Deren Adresse enthält einen langen,
          zufälligen Schlüssel. Wer den Link hat, sieht die Tickets. Gib ihn
          deshalb nur an Menschen weiter, die mit dir kommen.
        </Absatz>
        <Absatz>
          Zahlung: Die Zahlung wickelt Stripe ab (Stripe Payments Europe Ltd.,
          Dublin, Irland). Kartendaten gibst du direkt in ein Formular von
          Stripe ein, sie erreichen unseren Server nie. Stripe prüft Zahlungen
          automatisiert auf Betrug und ist für diese Daten selbst
          verantwortlich. Wir erfahren nur, ob gezahlt wurde, und erhalten eine
          Vorgangsnummer. Stripe kann Daten an die Stripe, Inc. in den USA
          übermitteln. Stripe ist nach dem EU-US Data Privacy Framework
          zertifiziert. Mehr unter{" "}
          <a href="https://stripe.com/de/privacy" rel="noopener noreferrer" target="_blank">
            stripe.com/de/privacy
          </a>
          .
        </Absatz>
        <Absatz>
          Aufbewahrung: Bestellungen und Zahlungsbelege müssen wir nach
          Steuer- und Handelsrecht aufbewahren (§ 147 AO, § 257 HGB), je nach
          Unterlage acht oder zehn Jahre. Das gilt auch, wenn du dein Konto
          löschen lässt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. c DSGVO.
        </Absatz>
      </Block>

      <Block titel="5. Dein Konto">
        <Absatz>
          Du kannst dich mit deiner E-Mail-Adresse anmelden, um deine Tickets
          an einem Ort zu sehen. Ein Passwort gibt es für Gäste nicht, du
          bekommst einen Anmeldelink per Mail. Wir speichern deine Adresse,
          den Zeitpunkt der Anmeldungen und verknüpfen Käufe mit derselben
          Adresse mit deinem Konto. Die Anmeldung verwaltet Supabase (siehe
          Abschnitt 11). Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Auf
          Wunsch löschen wir das Konto. Bestellungen bleiben für die
          Aufbewahrungsfristen erhalten.
        </Absatz>
      </Block>

      <Block titel="6. E-Mails von uns">
        <Liste
          punkte={[
            "Tickets, Bestätigungen und Anmeldelinks sind Teil des Vertrags. Die bekommst du immer.",
            "Einladungen zu kommenden Events, etwa zum Presale: Wenn du bei uns gekauft hast, laden wir dich per Mail zu ähnlichen eigenen Events ein (§ 7 Abs. 3 UWG). Darauf weisen wir in der Kasse hin. Jede Mail enthält einen Link zum Abbestellen, und du kannst jederzeit per Mail widersprechen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
            "Newsletter: Trägst du dich ein, speichern wir nur die Adresse. Verschickt wird erst, wenn du den Link in einer Bestätigungsmail angeklickt hast (Double-Opt-in, Art. 6 Abs. 1 lit. a DSGVO). Die Einwilligung kannst du jederzeit widerrufen.",
          ]}
        />
        <Absatz>
          Unsere Mails verschickt Brevo (Sendinblue SAS, Paris, Frankreich,
          Server in der EU). Brevo verarbeitet dafür Adresse, Name und
          Mailinhalt und protokolliert die Zustellung.
        </Absatz>
      </Block>

      <Block titel="7. Warteliste, Gästeliste und VIP">
        <Absatz>
          Warteliste: Ist ein Event ausverkauft, kannst du dich mit Adresse,
          Vorname und gewünschter Anzahl eintragen. Du bestätigst den Eintrag
          per Link. Wird etwas frei, schicken wir dir ein Angebot mit Frist.
          Die Einträge löschen wir automatisch 30 Tage nach dem Event
          (Art. 6 Abs. 1 lit. b DSGVO).
        </Absatz>
        <Absatz>
          Gästeliste und VIP-Tickets auf Namen: Stehst du auf einer
          Gästeliste oder an einem VIP-Tisch, hat dich jemand aus unserem Team
          eingetragen. Wir speichern deinen Namen, die Zahl deiner Begleitung,
          den Tisch und, falls du die Tickets per Mail bekommen sollst, deine
          Adresse. Am Einlass sieht das Personal nur die Namensliste, keine
          Adressen (Art. 6 Abs. 1 lit. b und f DSGVO).
        </Absatz>
        <Absatz>
          VIP-Anfragen: Wir speichern die Angaben aus dem Formular, um dir ein
          Angebot zu machen (Art. 6 Abs. 1 lit. b DSGVO). Kommt kein Vertrag
          zustande, löschen wir die Anfrage automatisch nach sechs Monaten.
        </Absatz>
      </Block>

      <Block titel="8. Am Einlass und an der Garderobe">
        <Absatz>
          Beim Scannen deines Tickets speichern wir, wann und von welchem
          Mitarbeiterkonto es entwertet wurde. So kann jedes Ticket nur einmal
          benutzt werden. Für die Garderobe speichern wir deine Marke, die
          Bügelnummer und die Zeitpunkte von Abgabe und Abholung. Die Geräte
          am Einlass laden vorab nur Prüfwerte der Ticketcodes, nicht die
          Codes selbst und keine Namen außer der Gästeliste
          (Art. 6 Abs. 1 lit. b und f DSGVO).
        </Absatz>
        <Absatz>
          Einlass ab 18: Das Alter prüfen wir am Einlass per Ausweis. Wir
          speichern dabei nichts.
        </Absatz>
      </Block>

      <Block titel="9. Fotos und Videos auf Events">
        <Absatz>
          Auf unseren Events fotografieren und filmen wir, um zu zeigen, wie
          die Abende sind. Die Aufnahmen erscheinen auf dieser Seite und auf
          unseren Social-Media-Kanälen. Rechtsgrundlage ist unser berechtigtes
          Interesse an der Darstellung unserer Events (Art. 6 Abs. 1 lit. f
          DSGVO). Du kannst jederzeit widersprechen: Sag es vor Ort dem
          Fotografen oder schreib uns, dann nehmen wir Bilder, auf denen du
          erkennbar bist, heraus, soweit das möglich ist.
        </Absatz>
      </Block>

      <Block titel="10. Wenn du uns schreibst">
        <Absatz>
          Mails an kontakt@lunar-events.de nimmt Cloudflare entgegen
          (Cloudflare, Inc., USA, zertifiziert nach dem EU-US Data Privacy
          Framework) und leitet sie an unser Postfach bei Google weiter
          (Google Ireland Ltd., Dublin). Wir verwenden deine Nachricht nur, um
          dir zu antworten, und löschen sie, wenn die Sache erledigt ist und
          keine Aufbewahrungspflicht besteht (Art. 6 Abs. 1 lit. b und f
          DSGVO).
        </Absatz>
      </Block>

      <Block titel="11. Wer in unserem Auftrag Daten verarbeitet">
        <Angaben
          zeilen={[
            [
              "Hosting",
              "Vercel Inc., USA. Liefert die Seiten aus. Die Server, die deine Anfragen bearbeiten, stehen in Frankfurt am Main. Die Auslieferung statischer Dateien kann über Server in deiner Nähe laufen.",
            ],
            [
              "Datenbank und Anmeldung",
              "Supabase Inc., USA. Datenbank und Konten liegen auf Servern in Frankfurt am Main (Amazon Web Services, eu-central-1).",
            ],
            [
              "E-Mail-Versand",
              "Brevo (Sendinblue SAS), Paris, Frankreich. Server in der EU.",
            ],
            [
              "Domain und E-Mail-Weiterleitung",
              "Cloudflare, Inc., USA. Namensauflösung der Domain und Weiterleitung eingehender Mails.",
            ],
            [
              "Postfach",
              "Google Ireland Ltd., Dublin, Irland.",
            ],
          ]}
        />
        <Absatz>
          Mit diesen Anbietern haben wir Verträge zur Auftragsverarbeitung
          nach Art. 28 DSGVO geschlossen oder deren Vertragsbedingungen
          übernommen. Anbieter mit Sitz in den USA sind nach dem EU-US Data
          Privacy Framework zertifiziert (Angemessenheitsbeschluss der
          EU-Kommission vom 10. Juli 2023). Zusätzlich gelten die
          Standardvertragsklauseln der EU-Kommission. Stripe ist für die
          Zahlungsdaten selbst verantwortlich (Abschnitt 4).
        </Absatz>
      </Block>

      <Block titel="12. Cookies und lokaler Speicher">
        <Absatz>
          Wir setzen nur, was für die Seite technisch nötig ist
          (§ 25 Abs. 2 Nr. 2 TDDDG). Dafür brauchen wir keine Einwilligung.
        </Absatz>
        <Liste
          punkte={[
            "Bestellung: hält während des Kaufs fest, welche Bestellung zu deinem Browser gehört. Läuft nach vier Stunden ab.",
            "Sprache: merkt sich, ob du Deutsch oder Englisch gewählt hast.",
            "Anmeldung: hält deine Sitzung, solange du angemeldet bist.",
            "Rabattcode und Presale: Ein Code oder eine Einladung aus einem Link wird im Speicher dieses Browser-Tabs gemerkt und ist weg, sobald du den Tab schließt.",
            "Stripe setzt beim Bezahlen eigene Cookies, um Betrug zu erkennen.",
          ]}
        />
        <Absatz>
          Setzen wir einmal Reichweitenmessung oder Werbe-Pixel ein, fragen wir
          vorher nach deiner Einwilligung.
        </Absatz>
      </Block>

      <Block titel="13. Wallet">
        <Absatz>
          Speicherst du ein Ticket in Apple Wallet oder Google Wallet,
          übertragen wir Event, Tickettyp und Ticketcode an den jeweiligen
          Anbieter (Apple Distribution International Ltd., Cork, Irland, oder
          Google Ireland Ltd., Dublin). Das passiert nur, wenn du den Knopf
          dafür antippst (Art. 6 Abs. 1 lit. b DSGVO).
        </Absatz>
      </Block>

      <Block titel="14. Deine Rechte">
        <Liste
          punkte={[
            "Auskunft über die Daten, die wir zu dir gespeichert haben (Art. 15 DSGVO)",
            "Berichtigung falscher Angaben (Art. 16)",
            "Löschung, soweit keine Aufbewahrungspflicht entgegensteht (Art. 17)",
            "Einschränkung der Verarbeitung (Art. 18)",
            "Herausgabe deiner Daten in einem gängigen Format (Art. 20)",
            "Widerspruch gegen Verarbeitungen, die auf berechtigten Interessen beruhen, und gegen Werbung jederzeit (Art. 21)",
            "Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3)",
          ]}
        />
        <Absatz>
          Eine Mail an kontakt@lunar-events.de genügt. Wir antworten innerhalb
          eines Monats. Du kannst dich außerdem bei einer
          Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO). Für uns
          zuständig ist der Hessische Beauftragte für Datenschutz und
          Informationsfreiheit, Postfach 3163, 65021 Wiesbaden.
        </Absatz>
        <Absatz>
          Automatisierte Entscheidungen im Sinne von Art. 22 DSGVO treffen wir
          nicht. Die Betrugsprüfung bei Zahlungen macht Stripe.
        </Absatz>
      </Block>

      <Block titel="15. Sicherheit">
        <Absatz>
          Alle Verbindungen sind verschlüsselt (TLS). Zugriff auf
          Kundendaten haben nur Admins. Personal am
          Einlass, an der Bar oder an der Garderobe sieht keine Bestellungen,
          Adressen oder Ticketcodes.
        </Absatz>
      </Block>
    </Textseite>
  );
}
