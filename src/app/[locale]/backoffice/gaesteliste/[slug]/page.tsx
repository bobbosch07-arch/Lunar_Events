import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { GaesteVerwaltung } from "@/components/GaesteVerwaltung";
import { Link } from "@/i18n/navigation";
import { darfCodesAendern } from "@/lib/backoffice";
import { versandEingerichtet } from "@/lib/mail";
import { eigeneAdresse } from "@/lib/stripe";
import { serverClient } from "@/lib/supabase/server";
import type { Gast } from "@/lib/typen";
import css from "../../backoffice.module.css";

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Gästeliste: ${slug}`, robots: { index: false, follow: false } };
}

export default async function GaestelisteEvent({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Gästeliste" />
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
    .select("id, slug, titel, beginn")
    .eq("slug", slug)
    .maybeSingle();
  if (!event) notFound();

  const [{ data: zeilen }, darfAendern, f] = await Promise.all([
    db
      .from("gaeste")
      .select("id, event_id, name, email, begleitung, notiz, token, mail_gesendet_am, tickets(status)")
      .eq("event_id", event.id)
      .is("entfernt_am", null)
      // VIP-Gäste (0028) stehen in derselben Tabelle, gepflegt werden sie
      // aber an ihrer Anfrage.
      .is("vip_anfrage_id", null)
      .order("name"),
    darfCodesAendern(),
    getFormatter(),
  ]);

  const gaeste: Gast[] = (zeilen ?? []).map((z) => {
    const tickets = (z.tickets ?? []) as Array<{ status: string }>;
    return {
      id: z.id as string,
      event_id: z.event_id as string,
      name: z.name as string,
      email: (z.email as string | null) ?? null,
      begleitung: z.begleitung as number,
      notiz: (z.notiz as string | null) ?? null,
      token: z.token as string,
      mail_gesendet_am: (z.mail_gesendet_am as string | null) ?? null,
      personen: tickets.filter((t) => t.status !== "storniert").length,
      drin: tickets.filter((t) => t.status === "entwertet").length,
    };
  });

  return (
    <>
      <p className={css.notiz} style={{ marginTop: 0, marginBottom: "var(--space-5)" }}>
        <Link href="/backoffice/gaesteliste">Alle Events</Link> ·{" "}
        <strong>{event.titel as string}</strong> · {f.dateTime(new Date(event.beginn as string), "kurz")}
      </p>
      <GaesteVerwaltung
        eventId={event.id as string}
        eventSlug={event.slug as string}
        gaeste={gaeste}
        darfAendern={darfAendern}
        versand={versandEingerichtet()}
        adresse={eigeneAdresse()}
      />
    </>
  );
}
