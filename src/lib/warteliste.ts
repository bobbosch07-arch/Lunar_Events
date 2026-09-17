import { dienstClient } from "./supabase/server";
import { eigeneAdresse } from "./stripe";
import { sendeWartelisteAngebot, versandEingerichtet } from "./mail";
import { wartelisteZustand, type WartelisteZustand } from "./typen";

/**
 * Warteliste auf dem Server (Migration 0020).
 *
 * Bewusst keine "use server"-Datei: Was hier steht, darf kein Browser direkt
 * aufrufen — die Versand-Route prüft vorher ihren Schlüssel, die
 * Serveraktionen den Token.
 */

/** Zwei UUIDs ohne Bindestriche, wie in der Tabelle erzeugt. */
export const WARTELISTE_TOKEN = /^[0-9a-f]{64}$/;

/** So viele Mails auf einmal — wie bei den Presale-Einladungen. */
const GLEICHZEITIG = 10;

/** "Freitag, 24. Oktober, 23:00" in Berliner Zeit. */
export function berlinerZeit(iso: string, mitWochentag = true, locale = "de-DE"): string {
  return new Intl.DateTimeFormat(locale, {
    ...(mitWochentag ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
}

export type AngebotsPosten = {
  phase_id: string;
  phase_name: string;
  menge: number;
  einzelpreis_cent: number;
  gebuehr_cent: number;
};

export type WartelisteEintrag = {
  id: string;
  token: string;
  email: string;
  vorname: string | null;
  anzahl: number;
  zustand: WartelisteZustand;
  bestellung: {
    id: string;
    nummer: string;
    kundeId: string;
    reserviertBis: string | null;
    zugangstoken: string;
    posten: AngebotsPosten[];
  } | null;
  event: {
    id: string;
    slug: string;
    titel: string;
    beginn: string;
    vorbei: boolean;
    ort: string;
  };
};

/** Liest einen Eintrag samt Angebot. null, wenn es den Token nicht gibt. */
export async function holeWartelisteEintrag(token: string): Promise<WartelisteEintrag | null> {
  if (!WARTELISTE_TOKEN.test(token)) return null;

  const { data } = await dienstClient()
    .from("warteliste")
    .select(
      `id, token, email, vorname, anzahl, bestaetigt_am, ausgetragen_am, angebot_am,
       bestellung:bestellungen(id, nummer, status, vorkasse, reserviert_bis, zugangstoken, kunde_id,
         positionen:bestellpositionen(phase_id, phase_name, menge, einzelpreis_cent, gebuehr_cent)),
       event:events(id, slug, titel, beginn, status, ort:orte(name, stadt))`,
    )
    .eq("token", token)
    .maybeSingle();

  if (!data) return null;

  const b = data.bestellung as unknown as {
    id: string;
    nummer: string;
    status: string;
    vorkasse: boolean;
    reserviert_bis: string | null;
    zugangstoken: string;
    kunde_id: string;
    positionen: AngebotsPosten[];
  } | null;
  const e = data.event as unknown as {
    id: string;
    slug: string;
    titel: string;
    beginn: string;
    status: string;
    ort: { name: string; stadt: string } | null;
  };

  return {
    id: data.id as string,
    token: data.token as string,
    email: data.email as string,
    vorname: (data.vorname as string | null) ?? null,
    anzahl: data.anzahl as number,
    zustand: wartelisteZustand(
      {
        bestaetigt_am: data.bestaetigt_am as string | null,
        ausgetragen_am: data.ausgetragen_am as string | null,
        angebot_am: data.angebot_am as string | null,
      },
      b,
    ),
    bestellung: b
      ? {
          id: b.id,
          nummer: b.nummer,
          kundeId: b.kunde_id,
          reserviertBis: b.reserviert_bis,
          zugangstoken: b.zugangstoken,
          posten: b.positionen ?? [],
        }
      : null,
    event: {
      id: e.id,
      slug: e.slug,
      titel: e.titel,
      beginn: e.beginn,
      vorbei:
        new Date(e.beginn).getTime() < Date.now() ||
        e.status === "abgesagt" ||
        e.status === "archiviert",
      ort: e.ort ? `${e.ort.name}, ${e.ort.stadt}` : "",
    },
  };
}

/**
 * Verschickt die Mails zu neuen Angeboten. Die Datenbank beansprucht jedes
 * Angebot vorher, damit Takt und Backoffice nicht beide dieselbe Mail
 * schicken; mit dem Beanspruchen beginnt die Frist. Kommt eine Mail nicht
 * an, wird das zurückgenommen und beim nächsten Takt neu versucht.
 */
export async function versendeAngebote(
  eventId: string | null = null,
): Promise<{ verschickt: number; fehlgeschlagen: number }> {
  // Ohne Versand gar nicht erst beanspruchen — sonst liefe eine Frist, von
  // der niemand etwas weiß.
  if (!versandEingerichtet()) return { verschickt: 0, fehlgeschlagen: 0 };

  const db = dienstClient();
  const { data, error } = await db.rpc("beanspruche_angebote", {
    p_event_id: eventId,
    p_grenze: 50,
  });
  if (error) {
    console.error("[warteliste] Angebote holen fehlgeschlagen:", error.message);
    return { verschickt: 0, fehlgeschlagen: 0 };
  }

  const liste = (data ?? []) as Array<{
    id: string;
    token: string;
    email: string;
    vorname: string | null;
    anzahl: number;
    reserviert_bis: string;
    event_titel: string;
    event_beginn: string;
    ort: string;
  }>;

  const adresse = eigeneAdresse();
  let verschickt = 0;
  let fehlgeschlagen = 0;

  for (let i = 0; i < liste.length; i += GLEICHZEITIG) {
    const stapel = liste.slice(i, i + GLEICHZEITIG);
    const ergebnisse = await Promise.all(
      stapel.map((a) =>
        sendeWartelisteAngebot({
          an: a.email,
          vorname: a.vorname,
          eventTitel: a.event_titel,
          wann: berlinerZeit(a.event_beginn),
          ort: a.ort,
          anzahl: a.anzahl,
          bis: berlinerZeit(a.reserviert_bis),
          kaufLink: `${adresse}/checkout?angebot=${a.token}`,
          freigebenLink: `${adresse}/warteliste/${a.token}`,
        }),
      ),
    );
    for (const [j, ok] of ergebnisse.entries()) {
      if (ok) {
        verschickt += 1;
        continue;
      }
      fehlgeschlagen += 1;
      const { error: zurueck } = await db.rpc("angebot_nicht_zugestellt", { p_id: stapel[j].id });
      if (zurueck) console.error("[warteliste] Zurücknehmen fehlgeschlagen:", zurueck.message);
    }
  }

  return { verschickt, fehlgeschlagen };
}

/**
 * Gibt freie Plätze eines Events an die Warteliste und verschickt gleich die
 * Mails. Nach allem, was Plätze frei machen kann: Speichern im Backoffice,
 * Aufräumen, Bestätigen oder Freigeben eines Eintrags. Der Takt in der
 * Datenbank macht dasselbe alle fünf Minuten — das hier ist nur schneller.
 */
export async function bedieneWarteliste(eventId: string | null = null): Promise<number> {
  const { data, error } = await dienstClient().rpc("bediene_warteliste", {
    p_event_id: eventId,
  });
  if (error) {
    console.error("[warteliste] Verteilen fehlgeschlagen:", error.message);
    return 0;
  }
  const neu = (data as number) ?? 0;
  if (neu > 0) await versendeAngebote(eventId);
  return neu;
}
