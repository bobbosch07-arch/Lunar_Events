import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { BackofficeRahmen } from "@/components/BackofficeRahmen";
import { EventFormular, type EventStand } from "@/components/EventFormular";
import { holeOrte } from "@/app/aktionen/event-speichern";
import { serverClient } from "@/lib/supabase/server";
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
    <BackofficeRahmen aktiv="/backoffice/events" titel="Event bearbeiten">
      <Inhalt slug={slug} />
    </BackofficeRahmen>
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
       phasen(id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft,
              leistungen, beschreibung, position, aktiv)`,
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
    phasen,
  };

  return <EventFormular start={stand} orte={orte} />;
}
