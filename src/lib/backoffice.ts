import { serverClient } from "./supabase/server";

/**
 * Abfragen fürs Backoffice. Alle laufen über die Sitzung des Mitarbeiters,
 * nicht über den Dienstschlüssel — so entscheiden die Zugriffsregeln, was
 * sichtbar ist, und nicht diese Datei.
 */

export type Kennzahlen = {
  umsatzCent: number;
  bezahlteBestellungen: number;
  verkaufteTickets: number;
  entwerteteTickets: number;
  kommendeEvents: number;
  offeneVip: number;
  offeneReservierungen: number;
  abgelaufeneReservierungen: number;
};

export async function holeKennzahlen(): Promise<Kennzahlen> {
  const db = await serverClient();
  const jetzt = new Date().toISOString();

  const [bestellungen, tickets, events, vip] = await Promise.all([
    db.from("bestellungen").select("status, gesamt_cent, reserviert_bis"),
    db.from("tickets").select("status"),
    db.from("events").select("id").eq("status", "veroeffentlicht").gt("beginn", jetzt),
    db.from("vip_anfragen").select("status").in("status", ["neu", "in_bearbeitung"]),
  ]);

  const alle = bestellungen.data ?? [];
  const bezahlt = alle.filter((b) => b.status === "bezahlt");
  const offen = alle.filter((b) => b.status === "offen");

  return {
    umsatzCent: bezahlt.reduce((s, b) => s + (b.gesamt_cent as number), 0),
    bezahlteBestellungen: bezahlt.length,
    verkaufteTickets: (tickets.data ?? []).filter((t) => t.status !== "storniert").length,
    entwerteteTickets: (tickets.data ?? []).filter((t) => t.status === "entwertet").length,
    kommendeEvents: (events.data ?? []).length,
    offeneVip: (vip.data ?? []).length,
    offeneReservierungen: offen.filter(
      (b) => !b.reserviert_bis || new Date(b.reserviert_bis as string) > new Date(),
    ).length,
    abgelaufeneReservierungen: offen.filter(
      (b) => b.reserviert_bis && new Date(b.reserviert_bis as string) <= new Date(),
    ).length,
  };
}

export type EventZeile = {
  id: string;
  slug: string;
  titel: string;
  status: string;
  beginn: string;
  ort: string;
  verkauft: number;
  kontingent: number | null;
  umsatzCent: number;
  phasen: number;
};

export async function holeEventZeilen(): Promise<EventZeile[]> {
  const db = await serverClient();

  const { data, error } = await db
    .from("events")
    .select(
      `id, slug, titel, status, beginn,
       ort:orte(name, stadt),
       phasen(id, preis_cent, gebuehr_cent, kontingent, verkauft, art)`,
    )
    .order("beginn", { ascending: false });

  if (error || !data) {
    console.error("[backoffice] Events laden fehlgeschlagen:", error?.message);
    return [];
  }

  // Bezahlte Bestellungen je Event, für den echten Umsatz. Die Summe aus
  // verkauft × Preis wäre zu hoch: sie enthielte auch Reservierungen, die
  // nie bezahlt wurden.
  const { data: bestellungen } = await db
    .from("bestellungen")
    .select("event_id, gesamt_cent")
    .eq("status", "bezahlt");

  const umsatzJeEvent = new Map<string, number>();
  for (const b of bestellungen ?? []) {
    const id = b.event_id as string;
    umsatzJeEvent.set(id, (umsatzJeEvent.get(id) ?? 0) + (b.gesamt_cent as number));
  }

  return data.map((e) => {
    const phasen = (e.phasen ?? []) as Array<{
      kontingent: number | null;
      verkauft: number;
      art: string;
    }>;
    const standard = phasen.filter((p) => p.art === "standard");
    const ort = e.ort as unknown as { name: string; stadt: string } | null;

    return {
      id: e.id as string,
      slug: e.slug as string,
      titel: e.titel as string,
      status: e.status as string,
      beginn: e.beginn as string,
      ort: ort ? `${ort.name}, ${ort.stadt}` : "—",
      verkauft: standard.reduce((s, p) => s + p.verkauft, 0),
      kontingent: standard.every((p) => p.kontingent === null)
        ? null
        : standard.reduce((s, p) => s + (p.kontingent ?? 0), 0),
      umsatzCent: umsatzJeEvent.get(e.id as string) ?? 0,
      phasen: phasen.length,
    };
  });
}

export type BestellZeile = {
  id: string;
  nummer: string;
  status: string;
  gesamtCent: number;
  zahlungsart: string | null;
  erstelltAm: string;
  kunde: string;
  email: string;
  event: string;
  tickets: number;
};

export async function holeBestellungen(grenze = 100): Promise<BestellZeile[]> {
  const db = await serverClient();

  const { data, error } = await db
    .from("bestellungen")
    .select(
      `id, nummer, status, gesamt_cent, zahlungsart, erstellt_am,
       kunde:kunden(vorname, nachname, email),
       event:events(titel),
       tickets(id)`,
    )
    .order("erstellt_am", { ascending: false })
    .limit(grenze);

  if (error || !data) {
    console.error("[backoffice] Bestellungen laden fehlgeschlagen:", error?.message);
    return [];
  }

  return data.map((b) => {
    const kunde = b.kunde as unknown as {
      vorname: string | null;
      nachname: string | null;
      email: string;
    } | null;
    const event = b.event as unknown as { titel: string } | null;

    return {
      id: b.id as string,
      nummer: b.nummer as string,
      status: b.status as string,
      gesamtCent: b.gesamt_cent as number,
      zahlungsart: (b.zahlungsart as string | null) ?? null,
      erstelltAm: b.erstellt_am as string,
      kunde:
        [kunde?.vorname, kunde?.nachname].filter(Boolean).join(" ") || "—",
      email: kunde?.email ?? "—",
      event: event?.titel ?? "—",
      tickets: ((b.tickets ?? []) as unknown[]).length,
    };
  });
}

export type VipZeile = {
  id: string;
  name: string;
  email: string;
  telefon: string | null;
  gaeste: number;
  paket: string | null;
  nachricht: string | null;
  status: string;
  erstelltAm: string;
  event: string | null;
  wunschdatum: string | null;
};

export async function holeVipAnfragen(): Promise<VipZeile[]> {
  const db = await serverClient();

  const { data, error } = await db
    .from("vip_anfragen")
    .select(
      `id, name, email, telefon, gaeste, paket, nachricht, status,
       erstellt_am, wunschdatum, event:events(titel)`,
    )
    .order("erstellt_am", { ascending: false });

  if (error || !data) {
    console.error("[backoffice] VIP-Anfragen laden fehlgeschlagen:", error?.message);
    return [];
  }

  return data.map((a) => ({
    id: a.id as string,
    name: a.name as string,
    email: a.email as string,
    telefon: (a.telefon as string | null) ?? null,
    gaeste: a.gaeste as number,
    paket: (a.paket as string | null) ?? null,
    nachricht: (a.nachricht as string | null) ?? null,
    status: a.status as string,
    erstelltAm: a.erstellt_am as string,
    wunschdatum: (a.wunschdatum as string | null) ?? null,
    event: (a.event as unknown as { titel: string } | null)?.titel ?? null,
  }));
}
