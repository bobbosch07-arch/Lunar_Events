import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { Knopf } from "@/components/Knopf";
import { TicketKarte, type TicketAnzeige } from "@/components/TicketKarte";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
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
      `id, nummer, status,
       kunde:kunden(vorname, nachname),
       event:events(titel, beginn, einlass, status, ort:orte(name, stadt, strasse, plz))`,
    )
    .eq("zugangstoken", token)
    .maybeSingle();

  if (!bestellung || bestellung.status !== "bezahlt") notFound();

  const [t, f] = await Promise.all([getTranslations("ticket"), getFormatter()]);

  const event = bestellung.event as unknown as {
    titel: string;
    beginn: string;
    einlass: string | null;
    status: string;
    ort: { name: string; stadt: string; strasse: string | null; plz: string | null };
  };
  const kunde = bestellung.kunde as unknown as {
    vorname: string | null;
    nachname: string | null;
  } | null;

  const { data: rohTickets } = await db
    .from("tickets")
    .select("code, phase_name, art, status, gast_name, platz")
    .eq("bestellung_id", bestellung.id)
    .order("erstellt_am", { ascending: true });

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
    event_titel: event.titel,
    event_wann: wann,
    event_ort: ort,
    bestellnummer: bestellung.nummer as string,
  }));

  const vorbei = new Date(event.beginn).getTime() < Date.now();

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
