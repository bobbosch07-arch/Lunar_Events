import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz, Liste, Luecke } from "@/components/Textseite";

export const metadata: Metadata = {
  title: "AGB",
  robots: { index: true, follow: false },
};

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
      vorspann="Für den Kauf von Tickets über diese Seite."
      warnung={{
        titel: "Entwurf — juristisch prüfen lassen",
        text: "Diese Bedingungen bilden ab, wie das System tatsächlich arbeitet. Sie sind aber kein anwaltlich geprüfter Text. Vor dem ersten echten Verkauf muss ein Fachanwalt darüber schauen — insbesondere über Widerruf, Absagefolgen und Haftung.",
      }}
      stand="Stand: September 2026."
    >
      <Block titel="1. Wer verkauft">
        <Absatz>
          Verkäufer der Tickets ist <Luecke>Firmierung</Luecke> („Lunar
          Events"). Die vollständigen Angaben stehen im Impressum.
        </Absatz>
      </Block>

      <Block titel="2. Wie ein Vertrag zustande kommt">
        <Absatz>
          Die Darstellung der Tickets auf dieser Seite ist noch kein bindendes
          Angebot. Mit dem Klick auf „Zahlungspflichtig bestellen" gibst du ein
          Angebot ab. Der Vertrag kommt zustande, sobald wir die Bestellung
          bestätigen und die Tickets bereitstellen.
        </Absatz>
        <Absatz>
          Zwischen Auswahl und Zahlung halten wir die Tickets 15 Minuten für
          dich zurück. Läuft diese Frist ab, ohne dass gezahlt wurde, geben wir
          sie wieder frei. Ein Anspruch auf die Reservierung besteht nicht.
        </Absatz>
      </Block>

      <Block titel="3. Preise und Gebühren">
        <Absatz>
          Alle Preise enthalten die gesetzliche Umsatzsteuer. Eine etwaige
          Servicegebühr ist im angezeigten Gesamtpreis enthalten und wird vor
          dem Kauf ausgewiesen.
        </Absatz>
      </Block>

      <Block titel="4. Tickets und Einlass">
        <Liste
          punkte={[
            "Jedes Ticket trägt einen Code, der genau einmal eingelöst werden kann. Wer zuerst scannt, kommt rein.",
            "Gib Tickets nur an Personen weiter, denen du vertraust. Wir können nicht prüfen, wer den Code wirklich besitzt.",
            "Am Einlass gilt das Hausrecht des Veranstaltungsortes. Dresscode und Mindestalter stehen bei jedem Event.",
            "Bei Verstoß gegen die Hausordnung oder erkennbarer Übermüdung durch Alkohol oder andere Mittel kann der Einlass verweigert werden — ohne Erstattung.",
          ]}
        />
      </Block>

      <Block titel="5. Kein Widerrufsrecht">
        <Absatz>
          Bei Dienstleistungen im Zusammenhang mit Freizeitveranstaltungen, für
          die ein bestimmter Termin vorgesehen ist, besteht kein Widerrufsrecht
          (§ 312 g Abs. 2 Nr. 9 BGB). Das gilt auch für Tickets, die über diese
          Seite gekauft werden. Auf diesen Umstand weisen wir vor dem Kauf
          gesondert hin und lassen ihn bestätigen.
        </Absatz>
      </Block>

      <Block titel="6. Wenn ein Event ausfällt oder verschoben wird">
        <Absatz>
          Fällt eine Veranstaltung aus, erstatten wir den Ticketpreis
          einschließlich Gebühren. Die Erstattung erfolgt auf demselben Weg, auf
          dem gezahlt wurde. Weitergehende Kosten — Anreise, Übernachtung,
          Verdienstausfall — werden nicht ersetzt.
        </Absatz>
        <Absatz>
          Wird eine Veranstaltung verschoben, behalten gekaufte Tickets ihre
          Gültigkeit für den Ersatztermin. Passt dir der neue Termin nicht,
          kannst du das Ticket innerhalb von <Luecke>Frist festlegen</Luecke>{" "}
          zurückgeben.
        </Absatz>
      </Block>

      <Block titel="7. Abendkasse">
        <Absatz>
          Wo eine Abendkasse angeboten wird, steht das beim Event. Der Preis an
          der Abendkasse kann abweichen, und es besteht kein Anspruch auf
          Einlass: Ist die Kapazität erreicht, ist sie erreicht. Nur online
          gekaufte Tickets sichern den Einlass.
        </Absatz>
      </Block>

      <Block titel="8. VIP-Anfragen">
        <Absatz>
          VIP-Pakete werden nicht über den Warenkorb verkauft, sondern
          individuell abgestimmt. Eine Anfrage ist unverbindlich; ein Vertrag
          kommt erst mit ausdrücklicher Bestätigung beider Seiten zustande.
        </Absatz>
      </Block>

      <Block titel="9. Haftung">
        <Absatz>
          Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie
          bei Verletzung von Leben, Körper und Gesundheit. Im Übrigen haften
          wir nur bei Verletzung wesentlicher Vertragspflichten und begrenzt auf
          den vertragstypischen, vorhersehbaren Schaden.
        </Absatz>
      </Block>

      <Block titel="10. Schlussbestimmungen">
        <Absatz>
          Es gilt deutsches Recht. Ist eine Bestimmung unwirksam, bleiben die
          übrigen wirksam.
        </Absatz>
      </Block>
    </Textseite>
  );
}
