import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Anmeldung } from "@/components/Anmeldung";
import { Kasse, type KassenEvent } from "@/components/Kasse";
import { Logo } from "@/components/Logo";
import { ZweiFaktor } from "@/components/ZweiFaktor";
import { holeAngemeldeten } from "@/lib/konto";
import { holeEventsFuerDenAbend } from "@/lib/events";
import { SPAETER_COOKIE } from "@/lib/passwort";
import { istRolle, ROLLEN_NAMEN } from "@/lib/rollen";
import { mitZweitemFaktor, sitzungAbgelaufen, zweiFaktorPflicht } from "@/lib/sitzung";
import { serverClient } from "@/lib/supabase/server";
import { stripeEingerichtet } from "@/lib/stripe";
import css from "../einlass/einlass.module.css";

export const metadata: Metadata = {
  title: "Kasse",
  robots: { index: false, follow: false },
};

/**
 * Die Abendkasse (Migration 0025). Wie der Scanner außerhalb der
 * Marken-Oberfläche: Hier zählt Lesbarkeit an der Tür.
 *
 * Wer an der Kasse steht, kommt an Geld — deshalb gilt hier wie im
 * Backoffice der zweite Faktor (sobald er scharf geschaltet ist).
 */
export default async function KassenSeite({
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
        <Anmeldung weiter="/kasse" />
      </main>
    );
  }

  const db = await serverClient();
  const { data: mitarbeiter } = await db
    .from("mitarbeiter")
    .select("rolle, aktiv")
    .eq("user_id", angemeldet.id)
    .maybeSingle();
  const rolle = mitarbeiter?.aktiv && istRolle(mitarbeiter.rolle) ? mitarbeiter.rolle : null;

  if (rolle !== "admin" && rolle !== "kasse") {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <div className={css.abweisung}>
          <h1 className={css.abweisungTitel}>Kein Zugang</h1>
          <p className={css.abweisungText}>
            {rolle
              ? `Als ${ROLLEN_NAMEN[rolle]} verkaufst du keine Tickets. Die Kasse ist für Kasse und Admin.`
              : `Dieses Konto (${angemeldet.email}) gehört nicht zum Team.`}
          </p>
        </div>
      </main>
    );
  }

  if (await sitzungAbgelaufen(rolle)) {
    redirect("/auth/abmelden?weiter=/kasse");
  }

  const [zweiterFaktor, pflicht, kekse] = await Promise.all([
    mitZweitemFaktor(),
    zweiFaktorPflicht(),
    cookies(),
  ]);
  if (!zweiterFaktor && (pflicht || !kekse.get(SPAETER_COOKIE))) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <ZweiFaktor art="tor" pflicht={pflicht} />
      </main>
    );
  }

  const [events, f] = await Promise.all([holeEventsFuerDenAbend(), getFormatter()]);
  const { data: phasen } = await db
    .from("phasen")
    .select("id, event_id, name, preis_cent, gebuehr_cent, kontingent, verkauft, position, aktiv")
    .eq("abendkasse", true)
    .eq("aktiv", true)
    .in(
      "event_id",
      events.map((e) => e.id),
    )
    .order("position");

  const auswahl: KassenEvent[] = events.map((e) => ({
    id: e.id,
    titel: e.titel,
    wann: f.dateTime(new Date(e.beginn), "kurz"),
    phasen: (phasen ?? [])
      .filter((p) => p.event_id === e.id)
      .map((p) => ({
        id: p.id as string,
        name: p.name as string,
        preis_cent: p.preis_cent as number,
        gebuehr_cent: p.gebuehr_cent as number,
        rest:
          p.kontingent === null
            ? null
            : Math.max((p.kontingent as number) - (p.verkauft as number), 0),
      })),
  }));

  if (auswahl.length === 0) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <div className={css.abweisung}>
          <h1 className={css.abweisungTitel}>Kein Event</h1>
          <p className={css.abweisungText}>
            Zurzeit ist keine Veranstaltung angesetzt, für die kassiert werden könnte.
          </p>
        </div>
      </main>
    );
  }

  return <Kasse events={auswahl} qrMoeglich={stripeEingerichtet()} />;
}
