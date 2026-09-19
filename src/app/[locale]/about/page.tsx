import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz } from "@/components/Textseite";

export const metadata: Metadata = {
  title: "About",
  description:
    "Lunar Events macht Nächte in Darmstadt, in denen sich jeder wohl und sicher fühlen kann.",
};

/**
 * Der Text entstand am 19.09.2026 aus einem kurzen Gespräch mit den
 * Veranstaltern: Immer „wir“, keine Namen. Anlass war ein Nachtleben in
 * Darmstadt, das sich tot und kaum nach Gemeinschaft anfühlte. „Premium“
 * meint vor allem, dass sich jeder wohl und sicher fühlt.
 */
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
    >
      <Block titel="Warum es uns gibt">
        <Absatz>
          In Darmstadt wird gern gefeiert. Trotzdem fühlte sich das Nachtleben
          für uns ziemlich tot an: viele Partys, aber kaum etwas, das
          zusammenhält. Keine Abende, auf die man sich freut, weil man dort
          seine Leute trifft.
        </Absatz>
        <Absatz>
          Das fanden wir schade. Also machen wir es selbst. Der Name ist schnell
          erklärt: Unsere Zeit ist die Nacht.
        </Absatz>
      </Block>

      <Block titel="Was wir machen">
        <Absatz>
          Ausgewählte Nächte in Darmstadt. Wir suchen die Räume, das Line-up und
          die Leute und lassen alles weg, was die Nacht nicht besser macht.
        </Absatz>
        <Absatz>
          Musikalisch sind wir im Club zu Hause, mit Ausflügen in alles, was zum
          Abend passt. Gedacht für alle, die Lust auf eine gute Nacht haben, die
          meisten von euch zwischen 18 und 30.
        </Absatz>
      </Block>

      <Block titel="Wofür wir stehen">
        <Absatz>
          Premium heißt für uns vor allem eins: Jeder soll sich wohl und sicher
          fühlen. Wir achten darauf, wer reinkommt und wie miteinander umgegangen
          wird. Partys, auf denen jeder macht, was er will, gibt es woanders.
        </Absatz>
        <Absatz>
          Ein voller Raum ist kein guter Raum. Wir begrenzen bewusst, wie viele
          Tickets es gibt, und sagen ehrlich, wenn etwas ausverkauft ist. Wer bei
          uns ein Ticket hat, kommt rein.
        </Absatz>
        <Absatz>
          Und wir hören zu. Was euch gefallen hat, was gefehlt hat, was euch
          gestört hat: Schreibt es uns. Die nächste Nacht planen wir danach.
        </Absatz>
      </Block>

      <Block titel="Zusammenarbeit">
        <Absatz>
          Location, Booking, Partnerschaft oder Presse:{" "}
          <a href="mailto:kontakt@lunar-events.de">kontakt@lunar-events.de</a>.
        </Absatz>
      </Block>
    </Textseite>
  );
}
