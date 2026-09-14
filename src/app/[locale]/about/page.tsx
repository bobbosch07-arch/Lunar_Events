import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz, Luecke } from "@/components/Textseite";

export const metadata: Metadata = {
  title: "About",
  description:
    "Lunar Events macht ein paar Nächte im Jahr in Frankfurt, Mannheim und Stuttgart. Und die sitzen.",
};

export default async function About({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite
      titel="THE NIGHT STARTS HERE."
      vorspann="Wir machen keine Veranstaltungen am laufenden Band. Wir machen ein paar Nächte im Jahr, und die sitzen."
      warnung={{
        titel: "Platzhaltertext",
        text: "Die Texte unten sind ein Vorschlag im Ton der Marke. Die eigentliche Geschichte — wer dahintersteckt, seit wann, warum — kennt nur ihr. Ersetzt sie, bevor die Seite öffentlich wird.",
      }}
    >
      <Block titel="Was wir machen">
        <Absatz>
          Ausgewählte Nächte in Frankfurt, Mannheim und Stuttgart. Wir suchen
          die Räume, das Line-up und die Leute — und lassen alles weg, was die
          Nacht nicht besser macht.
        </Absatz>
        <Absatz>
          <Luecke>Hier gehört eure Geschichte hin: seit wann, wie viele
          Veranstaltungen, was euch von anderen unterscheidet.</Luecke>
        </Absatz>
      </Block>

      <Block titel="Wofür wir stehen">
        <Absatz>
          Ein voller Raum ist kein guter Raum. Wir begrenzen bewusst, wie viele
          Tickets es gibt, und sagen ehrlich, wenn etwas ausverkauft ist. Wer
          bei uns ein Ticket hat, kommt rein — das ist keine Selbstverständ­lichkeit
          in diesem Geschäft.
        </Absatz>
      </Block>

      <Block titel="Zusammenarbeit">
        <Absatz>
          Location, Booking, Partnerschaft oder Presse:{" "}
          <a href="mailto:lunar.eventsss.de@gmail.com">lunar.eventsss.de@gmail.com</a>.
        </Absatz>
      </Block>
    </Textseite>
  );
}
