import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { EventAbschnitte } from "@/components/EventAbschnitte";
import { PhasenUebersicht, type PhaseZeile } from "@/components/PhasenUebersicht";
import { Link } from "@/i18n/navigation";
import type { EventAbschnitt, EventStand } from "@/lib/event-stand";
import { holeOrte } from "@/app/aktionen/event-speichern";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { PresaleEinladungen, type EinladungStand } from "@/components/PresaleEinladungen";
import { WartelisteUebersicht } from "@/components/WartelisteUebersicht";
import { PromoterStaffelFormular } from "@/components/PromoterStaffelFormular";
import { PromoterRangliste } from "@/components/PromoterRangliste";
import { darfCodesAendern } from "@/lib/backoffice";
import { phasenZustaende, verkaufsstartKommt, type Phase } from "@/lib/typen";
import bo from "../../backoffice.module.css";
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

export default async function EventUebersicht({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Event" />
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
       beginn, einlass, ende, ort_id, ort:orte(name, stadt), bild_pfad, bild_alt, bild_fokus, poster_statt_bild,
       mindestalter, dresscode, lineup, abendkasse, abendkasse_hinweis, featured,
       fastlane_aktiv, fastlane_preis_cent, fastlane_kontingent, fastlane_verkauft,
       fastlane_beschreibung, presale_ab, verkauf_ab,
       garderobe_aktiv, garderobe_preis_cent, garderobe_kontingent, garderobe_verkauft,
       streichpreis_cent, promo_stichtag,
       promoter_stufen(ab_tickets, belohnung),
       phasen(id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, ab, bis,
              leistungen, beschreibung, position, aktiv, abendkasse)`,
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!event) notFound();

  const orte = await holeOrte();

  const stufen = ((event.promoter_stufen ?? []) as Array<{ ab_tickets: number; belohnung: string }>)
    .map((x) => ({ ab: x.ab_tickets, belohnung: x.belohnung }))
    .sort((a, b) => a.ab - b.ab);

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
    lineup: ((event.lineup as string[] | null) ?? []).join(", "),
    abendkasse: (event.abendkasse as boolean) ?? false,
    abendkasseHinweis: (event.abendkasse_hinweis as string | null) ?? "",
    streichpreisEuro:
      event.streichpreis_cent === null ? "" : euroAus(event.streichpreis_cent as number),
    featured: (event.featured as boolean) ?? false,
    posterStattBild: (event.poster_statt_bild as boolean | null) ?? false,
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

  // ---------- Phasen mit Belegung ----------
  const [{ data: belegung }, { data: zaehler }] = await Promise.all([
    db.rpc("phasen_belegung", { p_event_id: event.id }),
    db.rpc("phasen_zaehlerstand", { p_event_id: event.id }),
  ]);
  const beleg = new Map(
    ((belegung ?? []) as Array<{ phase_id: string; bezahlt: number; reserviert: number }>).map((z) => [z.phase_id, z]),
  );
  const soll = new Map(
    ((zaehler ?? []) as Array<{ phase_id: string; ist: number; soll: number }>).map((z) => [z.phase_id, z.soll]),
  );
  const rohPhasen = ((event.phasen ?? []) as Array<Record<string, unknown>>)
    .map((p) => ({ ...p, event_id: event.id }) as unknown as Phase)
    .sort((a, b) => a.position - b.position);
  // Was Gäste online sehen: ohne Abendkasse-Phasen, die gibt es nur an der Tür.
  const zustaende = phasenZustaende(rohPhasen.filter((p) => !p.abendkasse));
  const datum = new Intl.DateTimeFormat("de-DE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });
  const phasenZeilen: PhaseZeile[] = rohPhasen.map((p) => {
    const z = zustaende.get(p.id);
    const stand: PhaseZeile["stand"] = !p.aktiv
      ? { text: "geschlossen", ton: "neutral" }
      : p.art === "vip"
        ? { text: "auf Anfrage", ton: "neutral" }
        : p.abendkasse
          ? { text: "nur Abendkasse", ton: "neutral" }
          : z?.art === "kaufbar"
            ? { text: "läuft", ton: "gut" }
            : z?.art === "folgt"
              ? { text: "folgt", ton: "warte" }
              : z?.art === "ausverkauft"
                ? { text: "ausverkauft", ton: "schlecht" }
                : z?.art === "spaeter"
                  ? { text: `ab ${datum.format(new Date(z.ab))}`, ton: "warte" }
                  : { text: "vorbei", ton: "neutral" };
    return {
      id: p.id,
      name: p.name,
      art: p.art === "vip" ? "vip" : "standard",
      preis_cent: p.preis_cent,
      gebuehr_cent: p.gebuehr_cent,
      kontingent: p.kontingent,
      verkauft: p.verkauft,
      bezahlt: beleg.get(p.id)?.bezahlt ?? 0,
      reserviert: beleg.get(p.id)?.reserviert ?? 0,
      // Ohne Antwort (keine Rechte, Fehler) keine Warnung: dann gilt der Zähler.
      soll: soll.get(p.id) ?? p.verkauft,
      aktiv: p.aktiv,
      abendkasse: p.abendkasse,
      leistungen: p.leistungen ?? [],
      beschreibung: p.beschreibung ?? null,
      stand,
    };
  });

  // ---------- Zusammenfassung je Abschnitt ----------
  const zeit = (iso: unknown) => (iso ? datum.format(new Date(iso as string)) + " Uhr" : "");
  const geld = (cent: unknown) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(((cent as number) ?? 0) / 100);
  const ort = event.ort as unknown as { name: string; stadt: string } | null;
  const STATUS: Record<string, string> = {
    entwurf: "Entwurf (nicht sichtbar)", veroeffentlicht: "Veröffentlicht", abgesagt: "Abgesagt", archiviert: "Archiviert",
  };
  const kurz = (t: unknown, n = 140) => {
    const x = ((t as string | null) ?? "").trim();
    return x.length > n ? `${x.slice(0, n)} …` : x;
  };
  const zusammenfassung: Record<EventAbschnitt, Array<[string, string]>> = {
    status: [
      ["Status", STATUS[event.status as string] ?? (event.status as string)],
      ["Startseite", event.featured ? "hervorgehoben" : "nicht hervorgehoben"],
    ],
    grunddaten: [
      ["Titel", event.titel as string],
      ["Adresse", `/events/${event.slug}`],
      ["Kategorie", event.kategorie as string],
      ["Untertitel", (event.untertitel as string | null) ?? ""],
      ["Teaser", kurz(event.teaser)],
      ["Beschreibung", kurz(event.beschreibung, 220)],
    ],
    wannwo: [
      ["Beginn", zeit(event.beginn)],
      ["Einlass", zeit(event.einlass)],
      ["Ende", zeit(event.ende)],
      ["Ort", ort ? `${ort.name}, ${ort.stadt}` : ""],
    ],
    verkauf: [
      ["Presale ab", zeit(event.presale_ab) || "kein Presale"],
      ["Verkauf ab", zeit(event.verkauf_ab) || "sofort"],
    ],
    einlass: [
      ["Mindestalter", event.mindestalter ? `ab ${event.mindestalter}` : ""],
      ["Dresscode", (event.dresscode as string | null) ?? ""],
      ["Line-up", ((event.lineup as string[] | null) ?? []).join(", ")],
      ["Abendkasse", event.abendkasse ? `ja${event.abendkasse_hinweis ? ` · ${event.abendkasse_hinweis}` : ""}` : "nein"],
      ["Streichpreis", event.streichpreis_cent ? geld(event.streichpreis_cent) : ""],
    ],
    fastlane: event.fastlane_aktiv
      ? [
          ["Fast Lane", "an"],
          ["Preis", geld(event.fastlane_preis_cent)],
          ["Verkauft", `${event.fastlane_verkauft ?? 0}${event.fastlane_kontingent === null ? " (ohne Grenze)" : ` von ${event.fastlane_kontingent}`}`],
        ]
      : [["Fast Lane", "aus"]],
    garderobe: event.garderobe_aktiv
      ? [
          ["Garderobe", "an"],
          ["Preis", geld(event.garderobe_preis_cent)],
          ["Gebucht", `${event.garderobe_verkauft ?? 0}${event.garderobe_kontingent === null ? " (ohne Grenze)" : ` von ${event.garderobe_kontingent}`}`],
        ]
      : [["Garderobe", "aus"]],
    bild: [
      ["Bild", event.bild_pfad ? "hochgeladen" : "keines, es erscheint das Poster"],
      ["Poster statt Bild", event.poster_statt_bild ? "ja" : "nein"],
    ],
  };

  return (
    <>
      <div style={{ maxWidth: 940, marginBottom: "var(--space-6)" }}>
        <h2 className={bo.seitentitel} style={{ marginBottom: 4 }}>
          {event.titel as string}
        </h2>
        <p className={bo.nebensache} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <span className={`${bo.marke_} ${event.status === "veroeffentlicht" ? bo.gut : event.status === "abgesagt" ? bo.schlecht : bo.neutral}`}>
            {STATUS[event.status as string] ?? (event.status as string)}
          </span>
          <span>{zeit(event.beginn)}{ort ? ` · ${ort.name}, ${ort.stadt}` : ""}</span>
          <Link href={`/events/${event.slug}`}>Eventseite ansehen</Link>
        </p>
      </div>
      <PhasenUebersicht eventId={event.id as string} phasen={phasenZeilen} />
      <div style={{ marginTop: "var(--space-6)" }}>
        <EventAbschnitte start={stand} orte={orte} zusammenfassung={zusammenfassung} />
      </div>
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
      <PromoterStaffelFormular
        eventId={event.id as string}
        stichtag={event.promo_stichtag ? utcNachBerlinFeld(event.promo_stichtag as string) : ""}
        stufen={stufen}
      />
      <PromoterRangliste
        eventId={event.id as string}
        stufen={stufen}
        stichtag={(event.promo_stichtag as string | null) ?? null}
      />
    </>
  );
}
