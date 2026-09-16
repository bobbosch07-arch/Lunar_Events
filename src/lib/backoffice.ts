import { serverClient } from "./supabase/server";
import type { Rabattcode } from "./typen";

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

  // Gezaehlt wird in der Datenbank, nicht hier.
  //
  // Vorher holte diese Funktion *alle* Bestellungen und *alle* Tickets und
  // zaehlte sie in JavaScript durch. Bei vier Testevents faellt das nicht
  // auf; nach einer ausverkauften Nacht sind es tausende Zeilen, die nur
  // uebertragen werden, um am Ende vier Zahlen zu ergeben. `head: true`
  // schickt gar keine Zeilen mit, nur die Anzahl.
  const zaehle = (tabelle: string) =>
    db.from(tabelle).select("id", { count: "exact", head: true });

  const [
    umsatzZeilen,
    tickets,
    entwertet,
    events,
    vip,
    offen,
    abgelaufen,
  ] = await Promise.all([
    // Die einzige Abfrage, die noch Zeilen braucht: Summieren kann
    // PostgREST nicht ohne eigene Funktion in der Datenbank.
    db.from("bestellungen").select("gesamt_cent").eq("status", "bezahlt"),
    zaehle("tickets").neq("status", "storniert"),
    zaehle("tickets").eq("status", "entwertet"),
    zaehle("events").eq("status", "veroeffentlicht").gt("beginn", jetzt),
    zaehle("vip_anfragen").in("status", ["neu", "in_bearbeitung"]),
    db
      .from("bestellungen")
      .select("id", { count: "exact", head: true })
      .eq("status", "offen")
      .or(`reserviert_bis.is.null,reserviert_bis.gt.${jetzt}`),
    db
      .from("bestellungen")
      .select("id", { count: "exact", head: true })
      .eq("status", "offen")
      .not("reserviert_bis", "is", null)
      .lte("reserviert_bis", jetzt),
  ]);

  const bezahlt = umsatzZeilen.data ?? [];

  return {
    umsatzCent: bezahlt.reduce((s, b) => s + (b.gesamt_cent as number), 0),
    bezahlteBestellungen: bezahlt.length,
    verkaufteTickets: tickets.count ?? 0,
    entwerteteTickets: entwertet.count ?? 0,
    kommendeEvents: events.count ?? 0,
    offeneVip: vip.count ?? 0,
    offeneReservierungen: offen.count ?? 0,
    abgelaufeneReservierungen: abgelaufen.count ?? 0,
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

/**
 * Ohne Angabe: alle Events, neueste zuerst — das ist die Eventliste.
 *
 * Mit `abJetzt` nur die kommenden, naechste zuerst. Die Uebersicht zeigt
 * davon sechs und hat vorher trotzdem die gesamte Historie geladen, samt
 * aller Phasen, um sie danach wegzuwerfen.
 */
export async function holeEventZeilen(
  optionen: { abJetzt?: boolean; grenze?: number } = {},
): Promise<EventZeile[]> {
  const db = await serverClient();
  const { abJetzt = false, grenze } = optionen;

  let abfrage = db
    .from("events")
    .select(
      `id, slug, titel, status, beginn,
       ort:orte(name, stadt),
       phasen(id, preis_cent, gebuehr_cent, kontingent, verkauft, art)`,
    )
    .order("beginn", { ascending: abJetzt });

  if (abJetzt) abfrage = abfrage.gt("beginn", new Date().toISOString());
  if (grenze) abfrage = abfrage.limit(grenze);

  const { data, error } = await abfrage;

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
    .eq("status", "bezahlt")
    // Nur die Bestellungen zu den Events, die gerade geladen wurden —
    // sonst kaeme die gesamte Verkaufshistorie mit, um sechs Zahlen zu
    // bilden.
    .in("event_id", data.map((e) => e.id as string));

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
  /** Vorkasse: wartet auf Überweisung, solange status "offen" ist. */
  vorkasse: boolean;
  reserviertBis: string | null;
  /** "rabattcode" bei einer Bestellung, die dank Code nichts kostete. */
  zahlungRef: string | null;
  rabattcode: string | null;
  codeRabattCent: number;
};

export async function holeBestellungen(grenze = 100): Promise<BestellZeile[]> {
  const db = await serverClient();

  const { data, error } = await db
    .from("bestellungen")
    .select(
      `id, nummer, status, gesamt_cent, zahlungsart, zahlung_ref, erstellt_am, vorkasse, reserviert_bis,
       rabattcode, code_rabatt_cent,
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
      vorkasse: Boolean(b.vorkasse),
      reserviertBis: (b.reserviert_bis as string | null) ?? null,
      zahlungRef: (b.zahlung_ref as string | null) ?? null,
      rabattcode: (b.rabattcode as string | null) ?? null,
      codeRabattCent: (b.code_rabatt_cent as number | null) ?? 0,
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

export type AuswertungZeile = {
  eventId: string;
  titel: string;
  gesehen: number;
  gewaehlt: number;
  kasse: number;
  gekauft: number;
};

/**
 * Wie viele von denen, die ein Event ansehen, kaufen am Ende?
 *
 * Die Zahlen stammen aus `ereignisse` — ohne Personenbezug, ohne
 * Cookie. Deshalb sind es Aufrufe, keine Besucher: Wer zweimal
 * hinschaut, zählt zweimal. Für Verhältnisse reicht das, für die
 * Aussage "wie viele verschiedene Leute" nicht.
 */
export async function holeAuswertung(tage = 90): Promise<AuswertungZeile[]> {
  const db = await serverClient();
  const { data, error } = await db.rpc("auswertung_je_event", { p_tage: tage });

  if (error || !data) {
    console.error("[backoffice] Auswertung fehlgeschlagen:", error?.message);
    return [];
  }

  return (data as Array<Record<string, unknown>>)
    .map((z) => ({
      eventId: z.event_id as string,
      titel: z.titel as string,
      gesehen: Number(z.gesehen ?? 0),
      gewaehlt: Number(z.gewaehlt ?? 0),
      kasse: Number(z.kasse ?? 0),
      gekauft: Number(z.gekauft ?? 0),
    }))
    .filter((z) => z.gesehen > 0 || z.gekauft > 0);
}

export type Herkunft = { quelle: string; anzahl: number };

export async function holeHerkunft(tage = 30): Promise<Herkunft[]> {
  const db = await serverClient();
  const seit = new Date(Date.now() - tage * 86400000).toISOString();

  const { data, error } = await db
    .from("ereignisse")
    .select("quelle")
    .eq("art", "event_gesehen")
    .gt("stunde", seit);

  if (error || !data) return [];

  const gezaehlt = new Map<string, number>();
  for (const z of data) {
    const q = (z.quelle as string) ?? "direkt";
    gezaehlt.set(q, (gezaehlt.get(q) ?? 0) + 1);
  }

  return [...gezaehlt.entries()]
    .map(([quelle, anzahl]) => ({ quelle, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl)
    .slice(0, 8);
}

export type HochPhase = {
  id: string;
  name: string;
  art: "standard" | "vip";
  preisCent: number;
  gebuehrCent: number;
  kontingent: number | null;
  verkauft: number;
  position: number;
  aktiv: boolean;
};

export type HochEvent = {
  id: string;
  titel: string;
  beginn: string;
  status: string;
  phasen: HochPhase[];
  fastlane: { aktiv: boolean; preisCent: number; kontingent: number | null; verkauft: number };
  /** Tatsächlich bezahlt, aus den Bestellungen — nicht hochgerechnet. */
  bezahltCent: number;
};

/**
 * Rohdaten für die Umsatz-Hochrechnung. Gerechnet wird im Browser, weil
 * dort mit Annahmen gespielt wird (Auslastung, Mengen, Zahlungskosten) —
 * die Datenbank liefert nur, was feststeht.
 */
export async function holeHochrechnung(): Promise<HochEvent[]> {
  const db = await serverClient();

  const { data, error } = await db
    .from("events")
    .select(
      `id, titel, beginn, status,
       fastlane_aktiv, fastlane_preis_cent, fastlane_kontingent, fastlane_verkauft,
       phasen(id, name, art, preis_cent, gebuehr_cent, kontingent, verkauft, position, aktiv)`,
    )
    .order("beginn", { ascending: true });

  if (error || !data) {
    console.error("[backoffice] Hochrechnung laden fehlgeschlagen:", error?.message);
    return [];
  }

  const { data: bezahlt } = await db
    .from("bestellungen")
    .select("event_id, gesamt_cent")
    .eq("status", "bezahlt")
    .in("event_id", data.map((e) => e.id as string));

  const jeEvent = new Map<string, number>();
  for (const b of bezahlt ?? []) {
    const id = b.event_id as string;
    jeEvent.set(id, (jeEvent.get(id) ?? 0) + (b.gesamt_cent as number));
  }

  return data.map((e) => ({
    id: e.id as string,
    titel: e.titel as string,
    beginn: e.beginn as string,
    status: e.status as string,
    phasen: ((e.phasen ?? []) as Array<Record<string, unknown>>)
      .map((p) => ({
        id: p.id as string,
        name: p.name as string,
        art: (p.art === "vip" ? "vip" : "standard") as "standard" | "vip",
        preisCent: (p.preis_cent as number) ?? 0,
        gebuehrCent: (p.gebuehr_cent as number) ?? 0,
        kontingent: (p.kontingent as number | null) ?? null,
        verkauft: (p.verkauft as number) ?? 0,
        position: (p.position as number) ?? 0,
        aktiv: (p.aktiv as boolean) ?? true,
      }))
      .sort((a, b) => a.position - b.position),
    fastlane: {
      aktiv: (e.fastlane_aktiv as boolean) ?? false,
      preisCent: (e.fastlane_preis_cent as number) ?? 0,
      kontingent: (e.fastlane_kontingent as number | null) ?? null,
      verkauft: (e.fastlane_verkauft as number) ?? 0,
    },
    bezahltCent: jeEvent.get(e.id as string) ?? 0,
  }));
}

/* ------------------------------------------------------------------ */
/* Rabattcodes                                                         */
/* ------------------------------------------------------------------ */

export type RabattcodeZeile = Rabattcode & {
  eventTitel: string | null;
  eventSlug: string | null;
  /** Nur bezahlte Bestellungen — eingeloest zählt offene mit. */
  bezahltTickets: number;
  bezahltRabattCent: number;
};

export type Einloesung = {
  id: string;
  nummer: string;
  status: string;
  vorkasse: boolean;
  erstelltAm: string;
  kunde: string;
  email: string;
  tickets: number;
  rabattCent: number;
  gesamtCent: number;
};

export type EventWahl = {
  id: string;
  titel: string;
  slug: string;
  beginn: string;
  /** Nur Standardphasen — VIP wird angefragt, nicht mit Code gekauft. */
  phasen: Array<{ id: string; name: string }>;
};

const CODE_SPALTEN = `id, code, art, wert, event_id, phasen_ids, gueltig_ab, gueltig_bis,
  max_tickets, eingeloest, einmal_pro_person, aktiv, notiz, erstellt_am,
  event:events(titel, slug)`;

function alsCodeZeile(
  z: Record<string, unknown>,
  bezahlt: Map<string, { tickets: number; cent: number }>,
): RabattcodeZeile {
  const event = z.event as { titel: string; slug: string } | null;
  const summe = bezahlt.get(z.id as string);
  return {
    id: z.id as string,
    code: z.code as string,
    art: z.art as Rabattcode["art"],
    wert: z.wert as number,
    event_id: (z.event_id as string | null) ?? null,
    phasen_ids: (z.phasen_ids as string[] | null) ?? null,
    gueltig_ab: (z.gueltig_ab as string | null) ?? null,
    gueltig_bis: (z.gueltig_bis as string | null) ?? null,
    max_tickets: (z.max_tickets as number | null) ?? null,
    eingeloest: z.eingeloest as number,
    einmal_pro_person: Boolean(z.einmal_pro_person),
    aktiv: Boolean(z.aktiv),
    notiz: (z.notiz as string | null) ?? null,
    erstellt_am: z.erstellt_am as string,
    eventTitel: event?.titel ?? null,
    eventSlug: event?.slug ?? null,
    bezahltTickets: summe?.tickets ?? 0,
    bezahltRabattCent: summe?.cent ?? 0,
  };
}

/** Was die Codes bisher wirklich gekostet haben — nur bezahlte Bestellungen. */
async function bezahlteEinloesungen(codeId?: string) {
  const db = await serverClient();
  let abfrage = db
    .from("bestellungen")
    .select("rabattcode_id, code_tickets, code_rabatt_cent")
    .eq("status", "bezahlt")
    .not("rabattcode_id", "is", null);
  if (codeId) abfrage = abfrage.eq("rabattcode_id", codeId);
  const { data } = await abfrage;

  const karte = new Map<string, { tickets: number; cent: number }>();
  for (const b of data ?? []) {
    const id = b.rabattcode_id as string;
    const alt = karte.get(id) ?? { tickets: 0, cent: 0 };
    karte.set(id, {
      tickets: alt.tickets + (b.code_tickets as number),
      cent: alt.cent + (b.code_rabatt_cent as number),
    });
  }
  return karte;
}

export async function holeRabattcodes(): Promise<RabattcodeZeile[]> {
  const db = await serverClient();
  const [{ data, error }, bezahlt] = await Promise.all([
    db.from("rabattcodes").select(CODE_SPALTEN).order("erstellt_am", { ascending: false }),
    bezahlteEinloesungen(),
  ]);

  if (error || !data) {
    console.error("[backoffice] Rabattcodes laden fehlgeschlagen:", error?.message);
    return [];
  }
  return data.map((z) => alsCodeZeile(z as Record<string, unknown>, bezahlt));
}

export async function holeRabattcode(
  id: string,
): Promise<{ code: RabattcodeZeile; einloesungen: Einloesung[] } | null> {
  const db = await serverClient();
  const [{ data: zeile }, bezahlt, { data: bestellungen }] = await Promise.all([
    db.from("rabattcodes").select(CODE_SPALTEN).eq("id", id).maybeSingle(),
    bezahlteEinloesungen(id),
    db
      .from("bestellungen")
      .select(
        `id, nummer, status, vorkasse, erstellt_am, code_tickets, code_rabatt_cent, gesamt_cent,
         kunde:kunden(vorname, nachname, email)`,
      )
      .eq("rabattcode_id", id)
      .order("erstellt_am", { ascending: false })
      .limit(300),
  ]);

  if (!zeile) return null;

  return {
    code: alsCodeZeile(zeile as Record<string, unknown>, bezahlt),
    einloesungen: (bestellungen ?? []).map((b) => {
      const kunde = b.kunde as unknown as {
        vorname: string | null;
        nachname: string | null;
        email: string;
      } | null;
      return {
        id: b.id as string,
        nummer: b.nummer as string,
        status: b.status as string,
        vorkasse: Boolean(b.vorkasse),
        erstelltAm: b.erstellt_am as string,
        kunde: [kunde?.vorname, kunde?.nachname].filter(Boolean).join(" ") || "—",
        email: kunde?.email ?? "—",
        tickets: b.code_tickets as number,
        rabattCent: b.code_rabatt_cent as number,
        gesamtCent: b.gesamt_cent as number,
      };
    }),
  };
}

/** Events für die Auswahl im Code-Formular, die jüngsten zuerst. */
export async function holeEventWahl(): Promise<EventWahl[]> {
  const db = await serverClient();
  const { data } = await db
    .from("events")
    .select("id, titel, slug, beginn, phasen(id, name, art, position)")
    .in("status", ["entwurf", "veroeffentlicht"])
    .order("beginn", { ascending: false })
    .limit(50);

  return (data ?? []).map((e) => ({
    id: e.id as string,
    titel: e.titel as string,
    slug: e.slug as string,
    beginn: e.beginn as string,
    phasen: ((e.phasen ?? []) as Array<{ id: string; name: string; art: string; position: number }>)
      .filter((p) => p.art === "standard")
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ id: p.id, name: p.name })),
  }));
}

/** Lesen darf das Team, ändern nur ein Admin — wie in den Zugriffsregeln. */
export async function darfCodesAendern(): Promise<boolean> {
  const db = await serverClient();
  const { data } = await db.rpc("ist_mitarbeiter", { mindestens: "admin" });
  return data === true;
}
