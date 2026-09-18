import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { Knopf } from "@/components/Knopf";
import { TicketKarte, type TicketAnzeige } from "@/components/TicketKarte";
import { GarderobenMarke, type MarkeAnzeige } from "@/components/GarderobenMarke";
import { GarderobeNachbuchen } from "@/components/GarderobeNachbuchen";
import { KopierFeld } from "@/components/KopierFeld";
import { UeberweisungsDaten } from "@/components/UeberweisungsDaten";
import { stelleZahlungSicher } from "@/app/aktionen/bestellung";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { eigeneAdresse, stripeEingerichtet } from "@/lib/stripe";
import {
  GARDEROBE_JE_TICKET,
  eventEnde,
  garderobeBis,
  type GarderobeZustand,
} from "@/lib/typen";
import { appleEingerichtet } from "@/lib/wallet/apple";
import { googleEingerichtet } from "@/lib/wallet/google";
import css from "./tickets.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Tickets",
  // Ein Ticketlink gehört nicht in einen Suchindex.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Die Tickets einer Bestellung, geöffnet über eine lange Zufallskennung
 * aus der Mail.
 *
 * Kein Konto, kein Cookie: Wer den Link hat, kommt an die Tickets — so
 * wie jemand, der ein Papierticket in der Hand hält. Das steht auch
 * ausdrücklich auf der Seite, damit niemand ihn arglos weitergibt.
 */
export default async function TicketAnsicht({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  // Eine plausible Länge vorab prüfen, damit kurze Rateversuche gar nicht
  // erst die Datenbank beschäftigen.
  if (!datenbankVerbunden() || token.length < 32) notFound();

  const db = dienstClient();
  const { data: bestellung } = await db
    .from("bestellungen")
    .select(
      `id, nummer, status, vorkasse, rabatt_cent, gesamt_cent, reserviert_bis, nachbuchung_zu,
       garderobe_menge,
       kunde:kunden(vorname, nachname),
       event:events(titel, beginn, einlass, ende, status, garderobe_aktiv, garderobe_preis_cent,
                    garderobe_kontingent, garderobe_verkauft,
                    ort:orte(name, stadt, strasse, plz))`,
    )
    .eq("zugangstoken", token)
    .maybeSingle();

  // Kein Kauf mit diesem Token? Dann vielleicht ein Eintrag auf der
  // Gästeliste (0021) oder eine VIP-Buchung (0028) — derselbe Link,
  // dieselbe Ansicht, nur ohne Bestellung.
  if (!bestellung) {
    return <GaesteTickets token={token} locale={locale} />;
  }
  // Eine Nachbuchung (0027) hat keine eigene Seite — ihre Marken stehen
  // unter den Tickets, zu denen sie gehört.
  if (bestellung.nachbuchung_zu) notFound();

  // Offene Vorkasse-Bestellungen zeigen die Bankverbindung; alles andere,
  // was nicht bezahlt ist, gibt es hier nicht.
  const wartetAufUeberweisung = bestellung?.status === "offen" && Boolean(bestellung?.vorkasse);
  if (!bestellung || (bestellung.status !== "bezahlt" && !wartetAufUeberweisung)) notFound();

  const [t, f] = await Promise.all([getTranslations("ticket"), getFormatter()]);

  const event = bestellung.event as unknown as {
    titel: string;
    beginn: string;
    einlass: string | null;
    ende: string | null;
    status: string;
    garderobe_aktiv: boolean;
    garderobe_preis_cent: number;
    garderobe_kontingent: number | null;
    garderobe_verkauft: number;
    ort: { name: string; stadt: string; strasse: string | null; plz: string | null };
  };
  const kunde = bestellung.kunde as unknown as {
    vorname: string | null;
    nachname: string | null;
  } | null;

  const { data: rohTickets } = await db
    .from("tickets")
    .select("code, phase_name, art, status, gast_name, platz, fastlane")
    .eq("bestellung_id", bestellung.id)
    .order("erstellt_am", { ascending: true });

  const wallet = { apple: appleEingerichtet(), google: googleEingerichtet() };
  const wann = f.dateTime(new Date(event.beginn), "mitZeit");
  const ort = `${event.ort.name}, ${event.ort.stadt}`;
  const name = [kunde?.vorname, kunde?.nachname].filter(Boolean).join(" ") || null;

  const tickets: TicketAnzeige[] = (rohTickets ?? []).map((z) => ({
    code: z.code as string,
    phase_name: z.phase_name as string,
    art: z.art === "vip" ? "vip" : "standard",
    status:
      z.status === "entwertet"
        ? "entwertet"
        : z.status === "storniert"
          ? "storniert"
          : "gueltig",
    gast_name: (z.gast_name as string | null) ?? name,
    platz: (z.platz as string | null) ?? null,
    fastlane: Boolean(z.fastlane),
    event_titel: event.titel,
    event_wann: wann,
    event_ort: ort,
    bestellnummer: bestellung.nummer as string,
    zugangstoken: token,
    wallet,
  }));

  if (wartetAufUeberweisung) {
    return (
      <div className={css.rahmen}>
        <header className={css.kopf}>
          <div className="seitenbreite">
            <Link href="/" aria-label="Lunar Events">
              <Logo ton="ivory" hoehe={40} prioritaet />
            </Link>
          </div>
        </header>
        <main className={css.inhalt}>
          <div className="seitenbreite">
            <div className={css.kopfzeile}>
              <span className="eyebrow">Zahlung ausstehend</span>
              <h1 className={css.titel}>{event.titel}</h1>
              <p className={css.wann}>{wann}</p>
            </div>
            <UeberweisungsDaten
              nummer={bestellung.nummer as string}
              betragCent={bestellung.gesamt_cent as number}
              rabattCent={(bestellung.rabatt_cent as number) ?? 0}
              bis={(bestellung.reserviert_bis as string | null) ?? null}
              locale={locale}
            />
          </div>
        </main>
      </div>
    );
  }

  // Vorbei ist ein Event erst an seinem Ende, nicht bei Beginn: Um halb zwölf
  // steht der Gast noch in der Schlange und bucht vielleicht Garderobe nach.
  const vorbei = eventEnde(event).getTime() < Date.now();
  const garderobe = await holeGarderobe({
    bestellungId: bestellung.id as string,
    eigeneMenge: (bestellung.garderobe_menge as number) ?? 0,
    tickets: tickets.filter((x) => x.status !== "storniert").length,
    event,
  });
  const tg = await getTranslations("garderobe");

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="ivory" hoehe={40} prioritaet />
          </Link>
        </div>
      </header>

      <main className={css.inhalt}>
        <div className="seitenbreite">
          <div className={css.kopfzeile}>
            <span className="eyebrow">{t("titel")}</span>
            <h1 className={css.titel}>{event.titel}</h1>
            <p className={css.wann}>{wann}</p>
            <p className={css.ort}>
              {event.ort.name}
              {event.ort.strasse ? `, ${event.ort.strasse}` : ""}
              {event.ort.plz ? `, ${event.ort.plz}` : ""} {event.ort.stadt}
            </p>
            {event.einlass ? (
              <p className={css.einlass}>
                Einlass ab {f.dateTime(new Date(event.einlass), {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                Uhr
              </p>
            ) : null}
          </div>

          {event.status === "abgesagt" ? (
            <p className={css.abgesagt}>
              Diese Veranstaltung wurde abgesagt. Der Ticketpreis wird
              erstattet — melde dich, falls nach zwei Wochen nichts
              angekommen ist.
            </p>
          ) : vorbei ? (
            <p className={css.hinweisBand}>Dieses Event ist vorbei.</p>
          ) : null}

          <div className={css.raster}>
            {tickets.map((ticket) => (
              <TicketKarte key={ticket.code} ticket={ticket} />
            ))}
          </div>

          {garderobe.marken.length > 0 || garderobe.nachbuchbar ? (
            <section className={css.abschnitt} aria-labelledby="garderobe-titel">
              <h2 id="garderobe-titel" className={css.abschnittTitel}>
                {tg("titel")}
              </h2>
              {garderobe.marken.length > 0 ? (
                <div className={css.raster}>
                  {garderobe.marken.map((marke, i) => (
                    <GarderobenMarke
                      key={marke.code}
                      marke={marke}
                      nr={i + 1}
                      gesamt={garderobe.marken.length}
                    />
                  ))}
                </div>
              ) : null}
              {garderobe.nachbuchbar ? (
                <GarderobeNachbuchen
                  token={token}
                  preisCent={event.garderobe_preis_cent}
                  max={garderobe.nachbuchbar.max}
                  rueckkehr={`${eigeneAdresse()}/tickets/${token}`}
                />
              ) : null}
            </section>
          ) : null}

          <div className={css.fuss}>
            <p className={css.warnung}>
              <strong>Wer diesen Link hat, kommt rein.</strong> Jeder Code lässt
              sich genau einmal einlösen — gib den Link nur an Leute weiter,
              denen du vertraust, und poste ihn nirgends öffentlich.
            </p>
            <p className={css.nummer}>
              Bestellnummer {bestellung.nummer as string}
            </p>
            <Knopf href="/events" stil="linieHell" groesse="klein">
              Weitere Events
            </Knopf>
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Die Garderobe einer Bestellung (0027): ihre Marken samt denen aus
 * Nachbuchungen, und ob sich noch etwas nachbuchen lässt.
 */
async function holeGarderobe({
  bestellungId,
  eigeneMenge,
  tickets,
  event,
}: {
  bestellungId: string;
  eigeneMenge: number;
  /** Nicht stornierte Tickets der Bestellung — je Ticket zwei Stück. */
  tickets: number;
  event: {
    beginn: string;
    ende: string | null;
    status: string;
    garderobe_aktiv: boolean;
    garderobe_kontingent: number | null;
    garderobe_verkauft: number;
  };
}): Promise<{ marken: MarkeAnzeige[]; nachbuchbar: { max: number } | null }> {
  const db = dienstClient();
  const liesNachbuchungen = async () =>
    (
      await db
        .from("bestellungen")
        .select("id, status, zahlung_ref, reserviert_bis, garderobe_menge")
        .eq("nachbuchung_zu", bestellungId)
    ).data ?? [];

  let nach = await liesNachbuchungen();
  // Nach dem Nachbuchen schickt Stripe hierher zurück, oft schneller als der
  // Webhook. Dann selbst nachfragen — wie auf der Bestätigungsseite.
  const offen = nach.filter(
    (b) => b.status === "offen" && (b.zahlung_ref as string | null)?.startsWith("pi_"),
  );
  if (offen.length > 0) {
    await Promise.all(offen.map((b) => stelleZahlungSicher(b.id as string)));
    nach = await liesNachbuchungen();
  }

  const ids = [bestellungId, ...nach.filter((b) => b.status === "bezahlt").map((b) => b.id as string)];
  const { data: roh } = await db
    .from("garderobe_marken")
    .select("code, status, nummer, abgegeben_am, abgeholt_am")
    .in("bestellung_id", ids)
    .order("erstellt_am", { ascending: true })
    .order("id", { ascending: true });

  const marken: MarkeAnzeige[] = (roh ?? []).map((m) => {
    const zustand: GarderobeZustand =
      m.status === "storniert"
        ? "storniert"
        : m.abgeholt_am
          ? "abgeholt"
          : m.abgegeben_am
            ? "haengt"
            : "offen";
    return { code: m.code as string, nummer: (m.nummer as string | null) ?? null, zustand };
  });

  // Dieselbe Rechnung wie reserviere_garderobe(): Laufende Reservierungen
  // zählen mit, sonst ginge die Grenze mit zwei offenen Tabs verloren.
  const jetzt = Date.now();
  const laufend = nach.filter(
    (b) =>
      b.status === "bezahlt" ||
      (b.status === "offen" &&
        (!b.reserviert_bis || new Date(b.reserviert_bis as string).getTime() > jetzt)),
  );
  const schon = eigeneMenge + laufend.reduce((s, b) => s + ((b.garderobe_menge as number) ?? 0), 0);
  const rest =
    event.garderobe_kontingent === null
      ? Infinity
      : event.garderobe_kontingent - event.garderobe_verkauft;
  const max = Math.min(GARDEROBE_JE_TICKET * tickets - schon, rest);

  // Nur anbieten, was sich auch bezahlen lässt: ohne Stripe kein Knopf.
  const nachbuchbar =
    event.garderobe_aktiv &&
    event.status === "veroeffentlicht" &&
    stripeEingerichtet() &&
    jetzt < garderobeBis(event).getTime() &&
    max > 0
      ? { max }
      : null;

  return { marken, nachbuchbar };
}

type ListenEvent = {
  titel: string;
  beginn: string;
  einlass: string | null;
  ende: string | null;
  status: string;
  ort: { name: string; stadt: string; strasse: string | null; plz: string | null };
};

const EVENT_FELDER = "titel, beginn, einlass, ende, status, ort:orte(name, stadt, strasse, plz)";

/**
 * Tickets ohne Bestellung: ein Eintrag auf der Gästeliste (0021), ein
 * einzelner VIP-Gast (0028) — oder, über den Link der anfragenden Person,
 * alle VIP-Tickets eines Tisches. Wie die Tickets eines Kaufs: Wer den Link
 * hat, kommt rein. Ohne Wallet-Knöpfe — Pässe hängen an einer Bestellung.
 */
async function GaesteTickets({ token, locale }: { token: string; locale: string }) {
  const db = dienstClient();
  const { data: gast } = await db
    .from("gaeste")
    .select(`id, name, entfernt_am, vip_anfrage_id, event:events(${EVENT_FELDER})`)
    .eq("token", token)
    .maybeSingle();
  if (!gast) return <VipTickets token={token} locale={locale} />;

  const [t, tv] = await Promise.all([getTranslations("ticket"), getTranslations("ticketVip")]);
  const vip = Boolean(gast.vip_anfrage_id);

  const { data: rohTickets } = await db
    .from("tickets")
    .select("code, phase_name, art, status, gast_name, platz")
    .eq("gast_id", gast.id)
    .neq("status", "storniert")
    .order("erstellt_am", { ascending: true })
    .order("id", { ascending: true });

  return (
    <ListenTickets
      locale={locale}
      eyebrow={vip ? tv("eyebrow") : t("gaesteliste")}
      event={gast.event as unknown as ListenEvent}
      entfernt={gast.entfernt_am ? (vip ? tv("storniert") : t("gastEntfernt")) : null}
      eintraege={
        gast.entfernt_am
          ? []
          : (rohTickets ?? []).map((z) => ({ ticket: z, ersatzName: gast.name as string, link: null }))
      }
      warnungTitel={vip ? tv("warnungTitel") : t("gastWarnungTitel")}
      warnung={vip ? tv("warnungEinzeln") : t("gastWarnung")}
    />
  );
}

/**
 * Alle VIP-Tickets eines Tisches (0028), über den Link der Person, die
 * angefragt hat. Unter jedem Ticket steht der Link nur für diesen Gast —
 * weitergeleitet hat dann jeder sein eigenes.
 */
async function VipTickets({ token, locale }: { token: string; locale: string }) {
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = dienstClient();
  const { data: anfrage } = await db
    .from("vip_anfragen")
    .select(`id, event:events(${EVENT_FELDER})`)
    .eq("token", token)
    .maybeSingle();
  if (!anfrage?.event) notFound();

  const { data: gaeste } = await db
    .from("gaeste")
    .select("id, name, token, erstellt_am, tickets(code, phase_name, art, status, gast_name, platz)")
    .eq("vip_anfrage_id", anfrage.id)
    .is("entfernt_am", null)
    .order("erstellt_am", { ascending: true })
    .order("id", { ascending: true });

  const tv = await getTranslations("ticketVip");
  const adresse = eigeneAdresse();
  const eintraege = (gaeste ?? []).flatMap((g) =>
    ((g.tickets ?? []) as Array<Record<string, unknown>>)
      .filter((z) => z.status !== "storniert")
      .map((z) => ({
        ticket: z,
        ersatzName: g.name as string,
        link: { name: g.name as string, adresse: `${adresse}/tickets/${g.token as string}` },
      })),
  );

  return (
    <ListenTickets
      locale={locale}
      eyebrow={tv("eyebrow")}
      event={anfrage.event as unknown as ListenEvent}
      entfernt={eintraege.length === 0 ? tv("storniert") : null}
      eintraege={eintraege}
      warnungTitel={tv("warnungTitel")}
      warnung={tv("warnung")}
    />
  );
}

/** Die gemeinsame Ansicht für Gästeliste und VIP. */
async function ListenTickets({
  locale,
  eyebrow,
  event,
  entfernt,
  eintraege,
  warnungTitel,
  warnung,
}: {
  locale: string;
  eyebrow: string;
  event: ListenEvent;
  /** Gesetzt, wenn es keine gültigen Tickets (mehr) gibt — der Grund. */
  entfernt: string | null;
  eintraege: Array<{
    ticket: Record<string, unknown>;
    ersatzName: string;
    /** Eigener Link des Gastes — nur auf der Seite mit allen VIP-Tickets. */
    link: { name: string; adresse: string } | null;
  }>;
  warnungTitel: string;
  warnung: string;
}) {
  const [t, tv, f] = await Promise.all([
    getTranslations("ticket"),
    getTranslations("ticketVip"),
    getFormatter({ locale }),
  ]);
  const wann = f.dateTime(new Date(event.beginn), "mitZeit");
  const ort = `${event.ort.name}, ${event.ort.stadt}`;
  const vorbei = eventEnde(event).getTime() < Date.now();

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="ivory" hoehe={40} prioritaet />
          </Link>
        </div>
      </header>

      <main className={css.inhalt}>
        <div className="seitenbreite">
          <div className={css.kopfzeile}>
            <span className="eyebrow">{eyebrow}</span>
            <h1 className={css.titel}>{event.titel}</h1>
            <p className={css.wann}>{wann}</p>
            <p className={css.ort}>
              {event.ort.name}
              {event.ort.strasse ? `, ${event.ort.strasse}` : ""}
              {event.ort.plz ? `, ${event.ort.plz}` : ""} {event.ort.stadt}
            </p>
            {event.einlass ? (
              <p className={css.einlass}>
                {t("einlassAb", {
                  zeit: f.dateTime(new Date(event.einlass), { hour: "2-digit", minute: "2-digit" }),
                })}
              </p>
            ) : null}
          </div>

          {entfernt ? (
            <p className={css.abgesagt}>{entfernt}</p>
          ) : event.status === "abgesagt" ? (
            <p className={css.abgesagt}>{t("gastAbgesagt")}</p>
          ) : vorbei ? (
            <p className={css.hinweisBand}>{t("vorbei")}</p>
          ) : null}

          <div className={css.raster}>
            {eintraege.map(({ ticket: z, ersatzName, link }) => (
              <div key={z.code as string} className={css.eintrag}>
                <TicketKarte
                  ticket={{
                    code: z.code as string,
                    phase_name: z.phase_name as string,
                    art: z.art === "vip" ? "vip" : "standard",
                    status: z.status === "entwertet" ? "entwertet" : "gueltig",
                    gast_name: (z.gast_name as string | null) ?? ersatzName,
                    platz: (z.platz as string | null) ?? null,
                    fastlane: false,
                    event_titel: event.titel,
                    event_wann: wann,
                    event_ort: ort,
                    bestellnummer: "",
                  }}
                />
                {link && z.status !== "entwertet" ? (
                  <KopierFeld
                    wert={link.adresse}
                    beschriftung={tv("kopieren")}
                    kopiert={tv("kopiert")}
                    klasse={css.gastLink}
                    wertKlasse={css.gastLinkWert}
                    stil="linieHell"
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div className={css.fuss}>
            <p className={css.warnung}>
              <strong>{warnungTitel}</strong> {warnung}
            </p>
            <Knopf href="/events" stil="linieHell" groesse="klein">
              {t("weitereEvents")}
            </Knopf>
          </div>
        </div>
      </main>
    </div>
  );
}
