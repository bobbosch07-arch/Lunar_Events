import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { EventFormular } from "@/components/EventFormular";
import type { EventStand } from "@/lib/event-stand";
import { holeOrte } from "@/app/aktionen/event-speichern";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { PresaleEinladungen, type EinladungStand } from "@/components/PresaleEinladungen";
import { WartelisteUebersicht } from "@/components/WartelisteUebersicht";
import { darfCodesAendern } from "@/lib/backoffice";
import { verkaufsstartKommt } from "@/lib/typen";
import { utcNachBerlinFeld } from "@/lib/zeit";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Event: ${slug}`, robots: { index: false, follow: false } };
}

/** In Euro-Schreibweise, so wie es im Formular stehen soll. */
function euroAus(cent: number): string {
  return (cent / 100).toFixed(2).replace(".", ",");
}

export default async function EventBearbeiten({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Event bearbeiten" />
      <Suspense fallback={<BackofficeSkelett zeilen={8} />}>
        <Inhalt slug={slug} />
      </Suspense>
    </>
  );
}

async function Inhalt({ slug }: { slug: string }) {
  const db = await serverClient();

  const { data: event } = await db
    .from("events")
    .select(
      `id, slug, titel, untertitel, teaser, beschreibung, kategorie, status,
       beginn, einlass, ende, ort_id, bild_pfad, bild_alt, bild_fokus,
       mindestalter, dresscode, abendkasse, abendkasse_hinweis, featured,
       fastlane_aktiv, fastlane_preis_cent, fastlane_kontingent, fastlane_verkauft,
       fastlane_beschreibung, presale_ab, verkauf_ab,
       garderobe_aktiv, garderobe_preis_cent, garderobe_kontingent, garderobe_verkauft,
       phasen(id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft,
              leistungen, beschreibung, position, aktiv, abendkasse)`,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const orte = await holeOrte();

  const phasen = ((event.phasen ?? []) as Array<Record<string, unknown>>)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      art: (p.art === "vip" ? "vip" : "standard") as "standard" | "vip",
      preisEuro: euroAus(p.preis_cent as number),
      gebuehrEuro: euroAus(p.gebuehr_cent as number),
      kontingent: p.kontingent === null ? "" : String(p.kontingent),
      leistungen: ((p.leistungen as string[]) ?? []).length
        ? (p.leistungen as string[])
        : [""],
      beschreibung: (p.beschreibung as string | null) ?? "",
      aktiv: (p.aktiv as boolean) ?? true,
      abendkasse: (p.abendkasse as boolean) ?? false,
      verkauft: (p.verkauft as number) ?? 0,
    }));

  const stand: EventStand = {
    id: event.id as string,
    slug: event.slug as string,
    titel: event.titel as string,
    untertitel: (event.untertitel as string | null) ?? "",
    teaser: (event.teaser as string | null) ?? "",
    beschreibung: (event.beschreibung as string | null) ?? "",
    kategorie: event.kategorie as string,
    status: event.status as string,
    beginn: utcNachBerlinFeld(event.beginn as string),
    einlass: event.einlass ? utcNachBerlinFeld(event.einlass as string) : "",
    ende: event.ende ? utcNachBerlinFeld(event.ende as string) : "",
    ortId: (event.ort_id as string) ?? "",
    bildPfad: (event.bild_pfad as string | null) ?? "",
    bildAlt: (event.bild_alt as string | null) ?? "",
    bildFokus: (event.bild_fokus as string | null) ?? "center",
    mindestalter:
      event.mindestalter === null ? "" : String(event.mindestalter),
    dresscode: (event.dresscode as string | null) ?? "",
    abendkasse: (event.abendkasse as boolean) ?? false,
    abendkasseHinweis: (event.abendkasse_hinweis as string | null) ?? "",
    featured: (event.featured as boolean) ?? false,
    fastlaneAktiv: (event.fastlane_aktiv as boolean) ?? false,
    fastlanePreisEuro: euroAus((event.fastlane_preis_cent as number) ?? 0),
    fastlaneKontingent:
      event.fastlane_kontingent === null ? "" : String(event.fastlane_kontingent),
    fastlaneBeschreibung: (event.fastlane_beschreibung as string | null) ?? "",
    fastlaneVerkauft: (event.fastlane_verkauft as number) ?? 0,
    garderobeAktiv: (event.garderobe_aktiv as boolean) ?? false,
    garderobePreisEuro: euroAus((event.garderobe_preis_cent as number) ?? 0),
    garderobeKontingent:
      event.garderobe_kontingent === null ? "" : String(event.garderobe_kontingent),
    garderobeVerkauft: (event.garderobe_verkauft as number) ?? 0,
    presaleAb: event.presale_ab ? utcNachBerlinFeld(event.presale_ab as string) : "",
    verkaufAb: event.verkauf_ab ? utcNachBerlinFeld(event.verkauf_ab as string) : "",
    phasen,
  };

  // Einladungen gibt es nur bei einem Event mit Presale. Die Zahlen liest der
  // Server mit dem Dienstschlüssel — sichtbar ist diese Seite ohnehin nur
  // fürs Team (Layout), verschicken darf nur ein Admin (Aktion prüft selbst).
  const mitPresale = Boolean(event.presale_ab && event.verkauf_ab);
  const [einladungStand, darfSenden] = mitPresale
    ? await Promise.all([
        dienstClient()
          .rpc("presale_einladung_stand", { p_event_id: event.id })
          .then(({ data }) => (data as EinladungStand | null) ?? { moeglich: 0, verschickt: 0, gekauft: 0 }),
        darfCodesAendern(),
      ])
    : [null, false];

  return (
    <>
      <EventFormular start={stand} orte={orte} />
      {einladungStand ? (
        <div style={{ maxWidth: 940, marginTop: "2rem" }}>
          <PresaleEinladungen
            eventId={event.id as string}
            stand={einladungStand}
            darfSenden={darfSenden}
            presaleLaeuftNoch={verkaufsstartKommt({ verkauf_ab: event.verkauf_ab as string })}
          />
        </div>
      ) : null}
      <WartelisteUebersicht eventId={event.id as string} />
    </>
  );
}
