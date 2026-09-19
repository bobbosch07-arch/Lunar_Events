import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz, Liste } from "@/components/Textseite";

export const metadata: Metadata = {
  title: "AGB",
  robots: { index: true, follow: false },
};

/**
 * Seit 19.09.2026 mit Hausordnung und dem, was am Abend gilt (Rückmeldung
 * eines Kunden: vorher nur der Kauf selbst). Fristen und Beträge sind
 * Vorschläge, anwaltlich noch nicht geprüft (Roadmap E13). Was hier
 * zugesagt wird, muss der Code einlösen: Reservierungsdauer (15 Minuten,
 * `reserviere`), Höchstmenge (20, `MAX_JE_BESTELLUNG`), Garderobe je Ticket.
 */
export default async function AGB({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite
      titel="Allgemeine Geschäftsbedingungen"
      vorspann="Für den Kauf von Tickets über diese Seite und für den Besuch unserer Events."
      stand="Stand: 19. September 2026."
    >
      <Block titel="1. Wer verkauft und veranstaltet">
        <Absatz>
          Verkäufer und Veranstalter ist Niklas Reyes Kretschmar,
          Einzelunternehmen, handelnd als Lunar Events, Kranichsteiner-Straße
          27, 64390 Erzhausen, kontakt@lunar-events.de. Diese Bedingungen
          gelten für alle Käufe über diese Seite, an der Abendkasse und für
          den Aufenthalt auf unseren Events.
        </Absatz>
      </Block>

      <Block titel="2. Wie ein Vertrag zustande kommt">
        <Liste
          punkte={[
            "Du wählst beim Event Tickets und Menge. Danach gibst du deine Daten ein und kannst Extras wie Fast Lane oder Garderobe dazubuchen.",
            "Mit dem Weiter zur Zahlung halten wir die Tickets 15 Minuten für dich zurück. Wird in dieser Zeit nicht bezahlt, geben wir sie wieder frei. Ein Anspruch auf die Reservierung besteht nicht.",
            "Vor dem Absenden siehst du alle Posten und den Gesamtpreis. Bis dahin kannst du jede Eingabe über „Zurück“ ändern.",
            "Mit dem Klick auf „Zahlungspflichtig bestellen“ gibst du ein verbindliches Angebot ab. Der Vertrag kommt zustande, sobald die Zahlung bestätigt ist und wir dir die Tickets bereitstellen.",
            "Vertragssprache ist Deutsch.",
          ]}
        />
        <Absatz>
          Wir speichern den Vertrag mit deiner Bestellung. Die Tickets bekommst
          du per E-Mail und findest sie dauerhaft auf deiner Ticketseite. Die
          Bestelldaten schicken wir dir auf Anfrage. Diese Bedingungen kannst
          du hier jederzeit aufrufen und speichern.
        </Absatz>
        <Absatz>
          Pro Bestellung gehen höchstens 20 Tickets. Mehrere offene
          Reservierungen gleichzeitig begrenzen wir, damit niemand Tickets
          blockiert, die er nicht kaufen will.
        </Absatz>
      </Block>

      <Block titel="3. Preise, Gebühren und Zahlung">
        <Absatz>
          Alle Preise sind Endpreise. Gemäß § 19 UStG wird keine Umsatzsteuer
          berechnet (Kleinunternehmerregelung). Die Servicegebühr ist im
          angezeigten Preis je Ticket enthalten und wird vor dem Kauf einzeln
          ausgewiesen. Extras wie Fast Lane oder Garderobe zeigen wir mit
          ihrem Preis, bevor du sie wählst. Nichts davon ist vorausgewählt.
        </Absatz>
        <Absatz>
          Du zahlst über Stripe, zum Beispiel per Karte, Apple Pay oder Google
          Pay. Wo wir Vorkasse anbieten, steht die Zahlungsfrist in der Kasse.
          Geht das Geld bis dahin nicht ein, verfällt die Bestellung. Rabattcodes
          gelten nur zu ihren Bedingungen, lassen sich nicht auszahlen und
          nicht nachträglich einlösen.
        </Absatz>
      </Block>

      <Block titel="4. Kein Widerrufsrecht">
        <Absatz>
          Für Tickets zu Freizeitveranstaltungen mit festem Termin besteht
          kein Widerrufsrecht (§ 312g Abs. 2 Nr. 9 BGB). Das gilt auch für
          Fast Lane und Garderobe, die zu einem bestimmten Event gehören. Wir
          weisen vor dem Kauf darauf hin und lassen es bestätigen.
        </Absatz>
      </Block>

      <Block titel="5. Tickets">
        <Liste
          punkte={[
            "Jedes Ticket trägt einen Code, der genau einmal eingelöst werden kann. Wer zuerst scannt, kommt rein. Schütze deine Tickets wie Bargeld.",
            "Geht ein Ticket verloren, schicken wir es dir erneut. Wurde es schon von jemand anderem eingelöst, können wir es nicht ersetzen.",
            "Private Weitergabe an Freunde ist erlaubt. Gewerblicher Weiterverkauf und Verkauf über dem Kaufpreis sind nicht erlaubt. Tickets aus solchen Verkäufen können wir sperren.",
            "Mit dem ersten Scan ist das Ticket entwertet. Wer das Event verlässt, hat keinen Anspruch auf Wiedereinlass.",
          ]}
        />
      </Block>

      <Block titel="6. Einlass">
        <Liste
          punkte={[
            "Das Mindestalter steht bei jedem Event. Bring einen gültigen amtlichen Ausweis mit. Ohne Ausweis oder unter dem Mindestalter gibt es keinen Einlass und keine Erstattung.",
            "Am Einlass kann es Taschen- und Personenkontrollen geben. Wer sie ablehnt, kommt nicht rein.",
            "Wir können den Einlass verweigern, etwa bei deutlicher Alkoholisierung oder unter Drogeneinfluss, bei Verstoß gegen den Dresscode oder die Hausordnung, oder wenn jemand schon einmal ausgeschlossen wurde. Liegt der Grund bei dir, gibt es keine Erstattung.",
            "Fast Lane heißt: eine eigene Spur am Einlass. Kontrollen gelten dort genauso. Ist das Event voll, gilt das Ticket, Fast Lane aber nur, solange die Spur geöffnet ist. Sonst erstatten wir den Fast-Lane-Preis.",
            "Gästeliste und VIP-Tische sind Einladungen ohne Anspruch auf einen bestimmten Platz, sofern nichts anderes vereinbart ist.",
          ]}
        />
      </Block>

      <Block titel="7. Hausordnung am Abend">
        <Absatz>
          Am Veranstaltungsort gilt unser Hausrecht und das des Betreibers.
          Den Anweisungen von Personal und Security ist zu folgen.
        </Absatz>
        <Liste
          punkte={[
            "Respekt gegenüber allen. Belästigung, Diskriminierung, Gewalt und Drohungen führen zum sofortigen Ausschluss. Wende dich jederzeit an unser Personal, wenn du dich unwohl fühlst.",
            "Keine Drogen, keine Waffen, keine gefährlichen Gegenstände, keine mitgebrachten Getränke, keine Glasflaschen, keine Pyrotechnik.",
            "Professionelle Kameras und Aufnahmegeräte nur mit unserer Erlaubnis.",
            "Beschädigungen gehen zu Lasten dessen, der sie verursacht.",
            "Wer ausgeschlossen wird, verliert sein Ticket ohne Erstattung.",
          ]}
        />
      </Block>

      <Block titel="8. Garderobe">
        <Liste
          punkte={[
            "Die Garderobe ist kostenpflichtig, je Ticket höchstens zwei Stück. Du bekommst dafür eine Marke mit QR-Code.",
            "Gib keine Wertsachen, kein Bargeld, keine Schlüssel und keine Ausweise ab. Dafür übernehmen wir keine Verwahrung.",
            "Die Ausgabe erfolgt gegen die Marke. Wer sie vorzeigt, bekommt das Stück. Geht die Marke verloren, geben wir das Stück nach Ende des Events heraus, wenn du es genau beschreiben kannst.",
            "Was nicht abgeholt wird, bewahren wir drei Monate auf. Melde dich per Mail. Danach dürfen wir es verwerten.",
          ]}
        />
      </Block>

      <Block titel="9. Foto- und Videoaufnahmen">
        <Absatz>
          Auf unseren Events wird fotografiert und gefilmt. Die Aufnahmen
          zeigen die Stimmung und erscheinen auf unserer Seite und unseren
          Social-Media-Kanälen. Willst du nicht drauf sein, sag es dem
          Fotografen vor Ort oder schreib uns danach. Wir nehmen dich dann
          heraus, soweit das möglich ist. Näheres steht in der
          Datenschutzerklärung.
        </Absatz>
      </Block>

      <Block titel="10. Gesundheit">
        <Absatz>
          Auf unseren Events ist es laut, und es gibt Licht- und
          Nebeleffekte. Wer empfindlich ist, zum Beispiel bei Epilepsie, nimmt
          auf eigenes Risiko teil. Denk an Gehörschutz.
        </Absatz>
      </Block>

      <Block titel="11. Änderungen, Absage und Verschiebung">
        <Absatz>
          Line-up und Ablauf können sich kurzfristig ändern, etwa wenn ein DJ
          ausfällt. Solange der Charakter des Events erhalten bleibt, ist das
          kein Grund für eine Erstattung.
        </Absatz>
        <Absatz>
          Sagen wir ein Event ab, erstatten wir den vollen Preis
          einschließlich Gebühren und Extras auf dem Weg, auf dem gezahlt
          wurde. Weitergehende Kosten wie Anreise oder Übernachtung ersetzen
          wir nicht, außer wir haben die Absage vorsätzlich oder grob
          fahrlässig verursacht.
        </Absatz>
        <Absatz>
          Verschieben wir ein Event, gelten die Tickets für den neuen Termin.
          Passt er dir nicht, kannst du das Ticket innerhalb von 14 Tagen nach
          Bekanntgabe zurückgeben und bekommst den vollen Preis erstattet.
        </Absatz>
      </Block>

      <Block titel="12. Abendkasse">
        <Absatz>
          Wo es eine Abendkasse gibt, steht das beim Event. Der Preis dort
          kann abweichen, und es gibt keinen Anspruch auf Einlass: Ist die
          Kapazität erreicht, ist sie erreicht. Nur online gekaufte Tickets
          sichern den Einlass.
        </Absatz>
      </Block>

      <Block titel="13. Warteliste und VIP-Anfragen">
        <Absatz>
          Die Warteliste ist ein Service ohne Anspruch auf ein Ticket. Wird
          etwas frei, bekommst du ein Angebot mit Frist. Wer nicht rechtzeitig
          kauft, verliert es an die nächste Person. VIP-Pakete stimmen wir
          einzeln ab. Eine Anfrage ist unverbindlich. Ein Vertrag kommt erst
          mit ausdrücklicher Bestätigung beider Seiten zustande.
        </Absatz>
      </Block>

      <Block titel="14. Haftung">
        <Absatz>
          Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei
          Verletzung von Leben, Körper und Gesundheit und nach dem
          Produkthaftungsgesetz. Bei leichter Fahrlässigkeit haften wir nur,
          wenn wir eine wesentliche Vertragspflicht verletzen, und begrenzt auf
          den typischen, vorhersehbaren Schaden. Für mitgebrachte Gegenstände,
          die nicht an der Garderobe abgegeben wurden, haften wir nur nach
          diesen Regeln.
        </Absatz>
      </Block>

      <Block titel="15. Schluss">
        <Absatz>
          Es gilt deutsches Recht. Bist du Verbraucher mit gewöhnlichem
          Aufenthalt in einem anderen EU-Land, bleiben dir die zwingenden
          Schutzvorschriften dieses Landes erhalten. Ist eine Bestimmung
          unwirksam, bleiben die übrigen wirksam. An einem
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
          nehmen wir nicht teil.
        </Absatz>
      </Block>
    </Textseite>
  );
}
