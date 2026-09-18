import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Anmeldung } from "@/components/Anmeldung";
import { GarderobeTresen } from "@/components/GarderobeTresen";
import { Logo } from "@/components/Logo";
import { holeAngemeldeten } from "@/lib/konto";
import { serverClient } from "@/lib/supabase/server";
import { holeEventsFuerDenAbend } from "@/lib/events";
import { sitzungAbgelaufen } from "@/lib/sitzung";
import { darfGarderobe, istRolle, ROLLEN_NAMEN } from "@/lib/rollen";
import css from "../einlass/einlass.module.css";

export const metadata: Metadata = {
  title: "Garderobe",
  robots: { index: false, follow: false },
};

/**
 * Der Garderobentresen fürs Personal (0027). Aufgebaut wie der Einlass:
 * außerhalb der Marken-Oberfläche, lesbar im Halbdunkel, und die Rolle
 * kommt aus der Datenbank, nicht aus dem Token.
 */
export default async function Garderobe({
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
        <Anmeldung weiter="/garderobe" />
      </main>
    );
  }

  const db = await serverClient();
  const { data: mitarbeiter } = await db
    .from("mitarbeiter")
    .select("name, rolle, aktiv")
    .eq("user_id", angemeldet.id)
    .maybeSingle();

  const rolle = istRolle(mitarbeiter?.rolle) ? mitarbeiter.rolle : null;

  if (!mitarbeiter?.aktiv || !rolle || !darfGarderobe(rolle)) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <div className={css.abweisung}>
          <h1 className={css.abweisungTitel}>Kein Zugang</h1>
          <p className={css.abweisungText}>
            {rolle && mitarbeiter?.aktiv
              ? `Als ${ROLLEN_NAMEN[rolle]} arbeitest du nicht an der Garderobe. Das dürfen Garderobe, Einlass, Bar und Kasse.`
              : `Dieses Konto (${angemeldet.email}) ist nicht fürs Personal freigeschaltet. Melde dich bei der Veranstaltungsleitung.`}
          </p>
        </div>
      </main>
    );
  }

  if (await sitzungAbgelaufen(rolle)) {
    redirect("/auth/abmelden?weiter=/garderobe");
  }

  const [events, f] = await Promise.all([holeEventsFuerDenAbend(), getFormatter()]);

  // Wie beim Einlass: auch Events, die schon laufen — abgeholt wird nachts.
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
            Zurzeit ist keine Veranstaltung angesetzt, für die die Garderobe
            geöffnet wäre.
          </p>
        </div>
      </main>
    );
  }

  return <GarderobeTresen events={auswahl} />;
}
