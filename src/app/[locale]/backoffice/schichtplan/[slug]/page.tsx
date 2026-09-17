import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import {
  SchichtplanVerwaltung,
  type PersonZeile,
  type SchichtZeile,
} from "@/components/SchichtplanVerwaltung";
import { Link } from "@/i18n/navigation";
import { versandEingerichtet } from "@/lib/mail";
import { istRolle } from "@/lib/rollen";
import { serverClient } from "@/lib/supabase/server";
import { utcNachBerlinFeld } from "@/lib/zeit";
import css from "../../backoffice.module.css";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Schichtplan: ${slug}`, robots: { index: false, follow: false } };
}

export default async function SchichtplanEvent({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Schichtplan" />
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
    .select("id, slug, titel, beginn, einlass, ende")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const [{ data: rohSchichten }, { data: rohPersonal }, f] = await Promise.all([
    db.from("schichten").select("*").eq("event_id", event.id).order("beginn"),
    db.from("mitarbeiter").select("user_id, name, rolle").eq("aktiv", true).order("name"),
    getFormatter(),
  ]);

  const personal: PersonZeile[] = (rohPersonal ?? [])
    .filter((p) => istRolle(p.rolle))
    .map((p) => ({
      user_id: p.user_id as string,
      name: p.name as string,
      rolle: p.rolle as PersonZeile["rolle"],
    }));

  const namen = new Map(personal.map((p) => [p.user_id, p.name]));
  const schichten: SchichtZeile[] = (rohSchichten ?? [])
    .filter((s) => istRolle(s.rolle))
    .map((s) => ({
      ...(s as unknown as SchichtZeile),
      // Wer aus dem Team genommen wurde, behält seine Schicht — für die
      // Abrechnung des Abends, an dem er noch da war.
      name: namen.get(s.user_id as string) ?? "Nicht mehr im Team",
    }));

  // Voreinstellung fürs Formular: vom Einlass (oder Beginn) bis zum Ende,
  // ersatzweise sechs Stunden — das ist die häufigste Schicht.
  const beginn = (event.einlass as string | null) ?? (event.beginn as string);
  const ende =
    (event.ende as string | null) ??
    new Date(new Date(beginn).getTime() + 6 * 3_600_000).toISOString();

  return (
    <>
      <p className={css.notiz} style={{ marginTop: 0, marginBottom: "var(--space-5)" }}>
        <Link href="/backoffice/schichtplan">Alle Events</Link> ·{" "}
        <strong>{event.titel as string}</strong> ·{" "}
        {f.dateTime(new Date(event.beginn as string), "kurz")}
      </p>
      <SchichtplanVerwaltung
        eventId={event.id as string}
        eventSlug={event.slug as string}
        eventBeginn={utcNachBerlinFeld(beginn)}
        eventEnde={utcNachBerlinFeld(ende)}
        schichten={schichten}
        personal={personal}
        versand={versandEingerichtet()}
      />
    </>
  );
}
