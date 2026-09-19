import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz, Angaben } from "@/components/Textseite";
import { Knopf } from "@/components/Knopf";

export const metadata: Metadata = {
  title: "Kontakt",
  description: "So erreichst du Lunar Events.",
};

export default async function Kontakt({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite
      titel="Kontakt"
      vorspann="Wir antworten meist am selben Tag."
    >
      <Block titel="Worum geht es?">
        <Angaben
          zeilen={[
            [
              "Tickets",
              <>
                Bestellung nicht angekommen, Frage zum Einlass:{" "}
                <a href="mailto:kontakt@lunar-events.de">
                  kontakt@lunar-events.de
                </a>
                . Halte deine Bestellnummer bereit, das geht schneller.
              </>,
            ],
            [
              "VIP",
              <>
                Tisch, Bottle Service oder Gruppen ab vier Personen? Dafür gibt
                es ein eigenes Formular.
              </>,
            ],
            [
              "Presse & Booking",
              <a key="p" href="mailto:kontakt@lunar-events.de">
                kontakt@lunar-events.de
              </a>,
            ],
          ]}
        />
      </Block>

      <Block titel="VIP anfragen">
        <Absatz>
          Für Tische und Gruppen geht es über das Anfrageformular am
          schnellsten. Wir melden uns innerhalb von 24 Stunden.
        </Absatz>
        <Knopf href="/vip" stil="gold">
          VIP anfragen
        </Knopf>
      </Block>
    </Textseite>
  );
}
