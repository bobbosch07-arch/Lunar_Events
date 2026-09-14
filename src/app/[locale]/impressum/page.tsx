import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz, Angaben } from "@/components/Textseite";

/**
 * Pflichtangaben nach § 5 DDG.
 *
 * Bewusst unauffällig: nur ein kleiner Verweis im Footer, nicht in der
 * Sitemap, und `noindex` — damit die Seite nicht bei einer Namenssuche in
 * Google auftaucht. Weiter verstecken geht nicht: Das Impressum muss
 * „leicht erkennbar und unmittelbar erreichbar" bleiben, sonst ist es
 * abmahnfähig. Ein Footer-Link auf jeder Seite erfüllt das.
 *
 * Register und USt-IdNr. fehlen absichtlich: Sie gehören nur hinein, wenn
 * es sie gibt. Nach Gewerbeanmeldung und Vergabe der USt-IdNr. ergänzen.
 */
export const metadata: Metadata = {
  title: "Impressum",
  robots: { index: false, follow: false },
};

const NAME = "Nicklas Reyes Kretschmar";
const ANSCHRIFT = "Kranichsteiner-Straße 27, 64390 Erzhausen";
const EMAIL = "lunar.eventsss.de@gmail.com";

export default async function Impressum({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite titel="Impressum" vorspann="Angaben gemäß § 5 Digitale-Dienste-Gesetz.">
      <Block titel="Anbieter">
        <Angaben
          zeilen={[
            ["Name", NAME],
            ["Anschrift", ANSCHRIFT],
            ["Handelnd als", "Lunar Events"],
          ]}
        />
      </Block>

      <Block titel="Kontakt">
        <Angaben
          zeilen={[
            [
              "E-Mail",
              <a key="m" href={`mailto:${EMAIL}`}>
                {EMAIL}
              </a>,
            ],
          ]}
        />
      </Block>

      <Block titel="Verantwortlich für den Inhalt">
        <Absatz>
          {NAME}, {ANSCHRIFT} — nach § 18 Abs. 2 Medienstaatsvertrag.
        </Absatz>
      </Block>

      <Block titel="Verbraucherstreitbeilegung">
        <Absatz>
          Wir sind nicht bereit und nicht verpflichtet, an
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
          teilzunehmen.
        </Absatz>
      </Block>
    </Textseite>
  );
}
