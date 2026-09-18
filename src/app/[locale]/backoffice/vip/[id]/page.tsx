import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import { VipBuchung, type VipBuchungStand } from "@/components/VipBuchung";
import { Link } from "@/i18n/navigation";
import { holeEventWahl } from "@/lib/backoffice";
import { versandEingerichtet } from "@/lib/mail";
import { eigeneAdresse } from "@/lib/stripe";
import { serverClient } from "@/lib/supabase/server";
import css from "../../backoffice.module.css";

type Props = { params: Promise<{ locale: string; id: string }> };

export const metadata: Metadata = {
  title: "VIP-Buchung",
  robots: { index: false, follow: false },
};

export default async function VipBuchungSeite({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="VIP-Buchung" />
      <Suspense fallback={<BackofficeSkelett zeilen={6} />}>
        <Inhalt id={id} />
      </Suspense>
    </>
  );
}

async function Inhalt({ id }: { id: string }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const db = await serverClient();
  const { data: anfrage } = await db
    .from("vip_anfragen")
    .select(
      `id, name, email, telefon, gaeste, paket, nachricht, status, wunschdatum, event_id,
       tisch, betrag_cent, bezahlt, token, tickets_gesendet_am, erstellt_am`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!anfrage) notFound();

  const [{ data: zeilen }, events, f] = await Promise.all([
    db
      .from("gaeste")
      .select("id, name, token, erstellt_am, tickets(status)")
      .eq("vip_anfrage_id", id)
      .is("entfernt_am", null)
      .order("erstellt_am", { ascending: true })
      .order("id", { ascending: true }),
    holeEventWahl(),
    getFormatter(),
  ]);

  const adresse = eigeneAdresse();
  const gaeste = (zeilen ?? []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    link: `${adresse}/tickets/${g.token as string}`,
    drin: ((g.tickets ?? []) as Array<{ status: string }>).some((t) => t.status === "entwertet"),
  }));

  // Noch nichts ausgestellt: so viele Zeilen, wie Gäste angefragt sind, die
  // erste mit dem Namen der anfragenden Person.
  const start: VipBuchungStand = {
    eventId: (anfrage.event_id as string | null) ?? "",
    tisch: (anfrage.tisch as string | null) ?? "",
    betragEuro:
      anfrage.betrag_cent === null
        ? ""
        : ((anfrage.betrag_cent as number) / 100).toFixed(2).replace(".", ",").replace(",00", ""),
    bezahlt: Boolean(anfrage.bezahlt),
    gaeste:
      gaeste.length > 0
        ? gaeste
        : Array.from({ length: Math.min(Math.max(anfrage.gaeste as number, 1), 30) }, (_, i) => ({
            id: null,
            name: i === 0 ? (anfrage.name as string) : "",
            link: null,
            drin: false,
          })),
  };

  // Das Event der Anfrage steht immer zur Wahl, auch wenn es aus der
  // Auswahlliste herausgefallen ist (vorbei oder archiviert).
  const wahl = events.map((e) => ({
    id: e.id,
    titel: e.titel,
    wann: f.dateTime(new Date(e.beginn), "kurz"),
  }));
  if (anfrage.event_id && !wahl.some((e) => e.id === anfrage.event_id)) {
    const { data: eigenes } = await db
      .from("events")
      .select("id, titel, beginn")
      .eq("id", anfrage.event_id as string)
      .maybeSingle();
    if (eigenes) {
      wahl.unshift({
        id: eigenes.id as string,
        titel: eigenes.titel as string,
        wann: f.dateTime(new Date(eigenes.beginn as string), "kurz"),
      });
    }
  }

  const gastgeberLink = anfrage.token ? `${adresse}/tickets/${anfrage.token as string}` : null;
  // Nach dem Speichern kommt der neue Stand vom Server — der Schlüssel sorgt
  // dafür, dass das Formular ihn übernimmt statt seinen alten zu behalten.
  const schluessel = [anfrage.token, ...gaeste.map((g) => `${g.id}:${g.name}`)].join("|");

  return (
    <>
      <p className={css.notiz} style={{ marginTop: 0, marginBottom: "var(--space-5)" }}>
        <Link href="/backoffice/vip">Alle Anfragen</Link> · <strong>{anfrage.name as string}</strong>{" "}
        · <a href={`mailto:${anfrage.email as string}`}>{anfrage.email as string}</a>
        {anfrage.telefon ? (
          <>
            {" "}
            · <a href={`tel:${anfrage.telefon as string}`}>{anfrage.telefon as string}</a>
          </>
        ) : null}
        <br />
        Angefragt: {anfrage.gaeste as number} Gäste · Paket {(anfrage.paket as string | null) ?? "offen"}
        {anfrage.wunschdatum ? ` · Wunsch: ${anfrage.wunschdatum as string}` : ""} · eingegangen{" "}
        {f.dateTime(new Date(anfrage.erstellt_am as string), "kurz")}
        {anfrage.nachricht ? (
          <>
            <br />„{anfrage.nachricht as string}“
          </>
        ) : null}
      </p>

      <VipBuchung
        key={schluessel}
        anfrageId={id}
        anfrageEmail={anfrage.email as string}
        events={wahl}
        start={start}
        gastgeberLink={gastgeberLink}
        versand={versandEingerichtet()}
        gesendetAm={
          anfrage.tickets_gesendet_am
            ? f.dateTime(new Date(anfrage.tickets_gesendet_am as string), "kurz")
            : null
        }
      />

      <p className={css.notiz}>
        Jeder Name bekommt ein eigenes VIP-Ticket mit QR-Code. Am Einlass zeigt
        der Scanner „VIP“, den Namen und den Tisch; ohne Handy steht der Gast
        mit Tisch auf der Namensliste. VIP-Tickets kommen obendrauf — sie zählen
        nicht als Verkauf.
      </p>
    </>
  );
}
