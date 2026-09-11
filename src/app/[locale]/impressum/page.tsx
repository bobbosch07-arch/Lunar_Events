import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Textseite, Block, Absatz, Angaben, Luecke } from "@/components/Textseite";

export const metadata: Metadata = {
  title: "Impressum",
  robots: { index: true, follow: false },
};

export default async function Impressum({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Textseite
      titel="Impressum"
      vorspann="Angaben gemäß § 5 Digitale-Dienste-Gesetz."
      warnung={{
        titel: "Noch auszufüllen",
        text: "Die markierten Stellen müssen durch die echten Firmendaten ersetzt werden. Ein unvollständiges Impressum ist abmahnfähig — diese Seite darf so nicht öffentlich bleiben.",
      }}
    >
      <Block titel="Anbieter">
        <Angaben
          zeilen={[
            ["Firma", <Luecke key="f">Vollständige Firmierung inkl. Rechtsform</Luecke>],
            ["Anschrift", <Luecke key="a">Straße, Hausnummer, PLZ, Ort</Luecke>],
            ["Vertreten durch", <Luecke key="v">Geschäftsführer / Inhaber</Luecke>],
          ]}
        />
      </Block>

      <Block titel="Kontakt">
        <Angaben
          zeilen={[
            ["Telefon", <Luecke key="t">Telefonnummer</Luecke>],
            [
              "E-Mail",
              <a key="m" href="mailto:kontakt@lunar-events.de">
                kontakt@lunar-events.de
              </a>,
            ],
          ]}
        />
        <Absatz>
          Die E-Mail-Adresse ist ein Vorschlag und muss eingerichtet sein,
          bevor diese Seite online geht.
        </Absatz>
      </Block>

      <Block titel="Register und Steuern">
        <Angaben
          zeilen={[
            ["Registergericht", <Luecke key="r">Amtsgericht, falls eingetragen</Luecke>],
            ["Registernummer", <Luecke key="n">HRB …</Luecke>],
            ["USt-IdNr.", <Luecke key="u">DE … (§ 27 a UStG)</Luecke>],
          ]}
        />
      </Block>

      <Block titel="Verantwortlich für den Inhalt">
        <Absatz>
          <Luecke>Name und Anschrift der verantwortlichen Person</Luecke> — nach
          § 18 Abs. 2 Medienstaatsvertrag.
        </Absatz>
      </Block>

      <Block titel="Streitbeilegung">
        <Absatz>
          Die Europäische Kommission stellt eine Plattform zur
          Online-Streitbeilegung bereit:{" "}
          <a
            href="https://ec.europa.eu/consumers/odr/"
            target="_blank"
            rel="noreferrer noopener"
          >
            ec.europa.eu/consumers/odr
          </a>
          .
        </Absatz>
        <Absatz>
          Wir sind nicht bereit und nicht verpflichtet, an
          Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
          teilzunehmen.
        </Absatz>
      </Block>
    </Textseite>
  );
}
