import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz } from "@/components/Textseite";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Antworten auf die Fragen, die am häufigsten kommen.",
};

/**
 * Die Antworten beschreiben, wie das System wirklich arbeitet, nicht wie es
 * schön klänge. Ändert sich die Mechanik, gehört diese Seite mit
 * angefasst.
 */
const FRAGEN: Array<[string, string[]]> = [
  [
    "Wo finde ich meine Tickets?",
    [
      "Direkt nach dem Kauf auf der Bestätigungsseite und per Mail. Außerdem kannst du dich mit derselben Adresse anmelden, dann liegen alle deine Tickets unter „Meine Tickets“.",
    ],
  ],
  [
    "Kann ich mein Ticket weitergeben?",
    [
      "Ja. Wer den Code zuerst am Einlass vorzeigt, kommt rein, denn der Code lässt sich genau einmal einlösen. Gib ihn deshalb nur an Leute weiter, denen du vertraust, und poste ihn nirgends öffentlich.",
    ],
  ],
  [
    "Warum sehe ich nicht alle Preise?",
    [
      "Du siehst, was schon weg ist, was gerade gilt und was als Nächstes kommt. Die Preise danach verraten wir erst, wenn es so weit ist. Früh kaufen lohnt sich also.",
    ],
  ],
  [
    "Gibt es eine Abendkasse?",
    [
      "Bei manchen Events, dann steht es dort. Der Preis kann abweichen, und einen Anspruch auf Einlass gibt es nicht: Ist voll, ist voll. Nur ein online gekauftes Ticket sichert dir den Platz.",
    ],
  ],
  [
    "Was ist VIP genau?",
    [
      "Ein eigener Tisch mit reservierter Fläche, Bottle Service am Platz und Einlass ohne Anstehen. Weil wir das vorher mit euch absprechen, läuft VIP über eine Anfrage und nicht über den Warenkorb.",
    ],
  ],
  [
    "Ich habe bezahlt, aber keine Tickets bekommen.",
    [
      "Das sollte nicht passieren: Tickets entstehen genau dann, wenn die Zahlung bestätigt ist. Melde dich mit deiner Bestellnummer bei kontakt@lunar-events.de, wir finden die Bestellung sofort.",
    ],
  ],
  [
    "Kann ich stornieren?",
    [
      "Bei Veranstaltungen mit festem Termin gibt es kein gesetzliches Widerrufsrecht. Fällt ein Event aus, erstatten wir den vollen Preis samt Gebühren. Wird es verschoben, gilt dein Ticket für den Ersatztermin.",
    ],
  ],
  [
    "Ab welchem Alter komme ich rein?",
    [
      "Das steht bei jedem Event. Bring einen Lichtbildausweis mit. Ohne kommt niemand rein, auch nicht mit Ticket.",
    ],
  ],
  [
    "Gibt es eine Garderobe?",
    [
      "Bei den meisten Events ja. Du kannst sie beim Ticketkauf dazubuchen oder später auf deiner Ticketseite. Statt einer Papiermarke bekommst du einen QR-Code. Hast du nichts gebucht, zahlst du vor Ort bar.",
    ],
  ],
];

export default async function FAQ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite
      titel="Häufige Fragen"
      vorspann="Kurz beantwortet. Fehlt etwas, schreib uns."
    >
      {FRAGEN.map(([frage, antworten]) => (
        <Block key={frage} titel={frage}>
          {antworten.map((a) => (
            <Absatz key={a}>{a}</Absatz>
          ))}
        </Block>
      ))}
    </Textseite>
  );
}
