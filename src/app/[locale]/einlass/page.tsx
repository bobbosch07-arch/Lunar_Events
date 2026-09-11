import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Anmeldung } from "@/components/Anmeldung";
import { EinlassScanner } from "@/components/EinlassScanner";
import { Logo } from "@/components/Logo";
import { holeAngemeldeten } from "@/lib/konto";
import { serverClient } from "@/lib/supabase/server";
import { holeKommendeEvents } from "@/lib/events";
import css from "./einlass.module.css";

export const metadata: Metadata = {
  title: "Einlass",
  robots: { index: false, follow: false },
};

/**
 * Der Scanner fürs Personal. Bewusst außerhalb der Marken-Oberfläche:
 * Hier zählt Lesbarkeit im Halbdunkel, nicht Atmosphäre.
 */
export default async function Einlass({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const angemeldet = await holeAngemeldeten();

  if (!angemeldet) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <Anmeldung weiter="/einlass" />
      </main>
    );
  }

  // Die Rolle steht in der Datenbank, nicht im Token — so lässt sie sich
  // entziehen, ohne auf das Ablaufen einer Sitzung zu warten.
  const db = await serverClient();
  const { data: mitarbeiter } = await db
    .from("mitarbeiter")
    .select("name, rolle, aktiv")
    .eq("user_id", angemeldet.id)
    .maybeSingle();

  if (!mitarbeiter?.aktiv) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <div className={css.abweisung}>
          <h1 className={css.abweisungTitel}>Kein Zugang</h1>
          <p className={css.abweisungText}>
            Dieses Konto ({angemeldet.email}) ist nicht fürs Einlasspersonal
            freigeschaltet. Melde dich bei der Veranstaltungsleitung.
          </p>
        </div>
      </main>
    );
  }

  const [events, f] = await Promise.all([
    holeKommendeEvents(),
    getFormatter(),
  ]);

  // Auch heute schon vergangene Events bleiben wählbar: Eine Nacht, die um
  // 23 Uhr begonnen hat, läuft um zwei noch — und genau dann wird gescannt.
  const auswahl = events.map((e) => ({
    id: e.id,
    titel: e.titel,
    wann: f.dateTime(new Date(e.beginn), "kurz"),
  }));

  if (auswahl.length === 0) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <div className={css.abweisung}>
          <h1 className={css.abweisungTitel}>Kein Event</h1>
          <p className={css.abweisungText}>
            Zurzeit ist keine Veranstaltung angesetzt, für die gescannt werden
            könnte.
          </p>
        </div>
      </main>
    );
  }

  return <EinlassScanner events={auswahl} />;
}
