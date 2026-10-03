/**
 * GA4-Zahlen fürs Backoffice („Auswertung“), über die Google Analytics
 * Data API (03.10.2026). Nur auf dem Server.
 *
 * Zugang ist ein **Dienstkonto** mit Leserecht auf die GA4-Property, kein
 * einfacher API-Schlüssel: Google rückt Analysedaten nur an ein Konto
 * heraus, das in der Property als „Betrachter“ eingetragen ist.
 *
 *   GA_PROPERTY_ID       die Zahl unter Verwaltung → Property-Details
 *                        (nicht die Mess-ID G-…)
 *   GA_DIENSTKONTO_JSON  die Schlüsseldatei des Dienstkontos, roh oder
 *                        base64-verpackt (wie GOOGLE_WALLET_SERVICE_ACCOUNT_JSON)
 *
 * Die Antworten bleiben fünf Minuten im Speicher: Die Seite soll schnell
 * sein, und GA4 rechnet ohnehin mit Verzögerung (meist einige Stunden).
 */

type Dienstkonto = { client_email: string; private_key: string };

function dienstkonto(): Dienstkonto | null {
  const roh = process.env.GA_DIENSTKONTO_JSON;
  if (!roh) return null;
  try {
    const text = roh.trim().startsWith("{") ? roh : Buffer.from(roh, "base64").toString("utf8");
    const daten = JSON.parse(text) as Dienstkonto;
    return daten.client_email && daten.private_key ? daten : null;
  } catch {
    console.error("[ga] GA_DIENSTKONTO_JSON ist kein gültiges JSON.");
    return null;
  }
}

function propertyId(): string | null {
  const id = process.env.GA_PROPERTY_ID?.trim().replace(/^properties\//, "");
  return id && /^\d+$/.test(id) ? id : null;
}

export function gaDatenEingerichtet(): boolean {
  return Boolean(propertyId() && dienstkonto());
}

/** Die Adresse des Dienstkontos, für den Hinweis „in GA4 freigeben“. */
export function gaDienstkontoAdresse(): string | null {
  return dienstkonto()?.client_email ?? null;
}

let zugang: { token: string; bis: number } | null = null;

async function zugangstoken(): Promise<string> {
  if (zugang && zugang.bis > Date.now() + 60_000) return zugang.token;
  const konto = dienstkonto();
  if (!konto) throw new Error("Dienstkonto fehlt.");
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    credentials: { ...konto, private_key: konto.private_key.replace(/\\n/g, "\n") },
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const client = await auth.getClient();
  const antwort = await client.getAccessToken();
  if (!antwort.token) throw new Error("Anmeldung bei Google fehlgeschlagen.");
  // Google-Zugangstoken gelten eine Stunde.
  zugang = { token: antwort.token, bis: Date.now() + 55 * 60_000 };
  return antwort.token;
}

type Bericht = {
  rows?: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;
};

class GaFehler extends Error {
  constructor(
    meldung: string,
    readonly status: number,
  ) {
    super(meldung);
  }
}

async function frage<T>(pfad: string, koerper: unknown): Promise<T> {
  const token = await zugangstoken();
  const antwort = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId()}:${pfad}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(koerper),
      cache: "no-store",
    },
  );
  if (!antwort.ok) {
    const fehler = (await antwort.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GaFehler(fehler?.error?.message ?? `HTTP ${antwort.status}`, antwort.status);
  }
  return (await antwort.json()) as T;
}

const zahl = (v: string | undefined) => Number(v ?? 0) || 0;

function zeilen(b: Bericht | undefined): Array<{ d: string[]; m: number[] }> {
  return (b?.rows ?? []).map((r) => ({
    d: (r.dimensionValues ?? []).map((x) => x.value),
    m: (r.metricValues ?? []).map((x) => zahl(x.value)),
  }));
}

export type GaUebersicht = {
  tage: number;
  kennzahlen: {
    besucher: number;
    neu: number;
    sitzungen: number;
    aufrufe: number;
    dauerSek: number;
    engagement: number;
    kaeufe: number;
    umsatz: number;
  };
  /** Aktive Nutzer in den letzten 30 Minuten. */
  jetzt: number | null;
  verlauf: Array<{ tag: string; besucher: number }>;
  quellen: Array<{ name: string; sitzungen: number; besucher: number; kaeufe: number }>;
  /** Je Schritt: wie viele Personen ihn gemacht haben. */
  trichter: Record<string, number>;
  seiten: Array<{ pfad: string; aufrufe: number; besucher: number }>;
  kampagnen: Array<{ name: string; sitzungen: number; kaeufe: number }>;
  geraete: Array<{ name: string; besucher: number }>;
  staedte: Array<{ name: string; besucher: number }>;
  events: Array<{ name: string; gesehen: number; gewaehlt: number; gekauft: number; umsatz: number }>;
  /** null: In GA4 fehlt die eigene Dimension „ziel“. */
  klicks: Array<{ ziel: string; anzahl: number }> | null;
  /** Wie viele `view_item` GA4 gesehen hat, für den Vergleich mit der eigenen Zählung. */
  eventAufrufe: number;
};

export type GaErgebnis =
  | { ok: true; daten: GaUebersicht; abgerufen: string }
  | { ok: false; grund: "nicht_eingerichtet" }
  | { ok: false; grund: "fehler"; meldung: string };

const ZWISCHENSPEICHER = new Map<number, { bis: number; ergebnis: GaErgebnis }>();
const HALTEN_MS = 5 * 60_000;

export const TRICHTER = [
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "add_shipping_info",
  "purchase",
] as const;

export async function holeGaUebersicht(tage: number): Promise<GaErgebnis> {
  if (!gaDatenEingerichtet()) return { ok: false, grund: "nicht_eingerichtet" };
  const gemerkt = ZWISCHENSPEICHER.get(tage);
  if (gemerkt && gemerkt.bis > Date.now()) return gemerkt.ergebnis;

  const zeitraum = [{ startDate: `${tage - 1}daysAgo`, endDate: "today" }];
  const bericht = (
    dimensionen: string[],
    metriken: string[],
    extra: Record<string, unknown> = {},
  ) => ({
    dateRanges: zeitraum,
    dimensions: dimensionen.map((name) => ({ name })),
    metrics: metriken.map((name) => ({ name })),
    ...extra,
  });
  const absteigend = (metrik: string) => ({ orderBys: [{ metric: { metricName: metrik }, desc: true }] });

  try {
    const [a, b, echtzeit, klicks] = await Promise.all([
      frage<{ reports: Bericht[] }>("batchRunReports", {
        requests: [
          bericht([], [
            "activeUsers", "newUsers", "sessions", "screenPageViews",
            "averageSessionDuration", "engagementRate", "ecommercePurchases", "purchaseRevenue",
          ]),
          bericht(["date"], ["activeUsers"], {
            orderBys: [{ dimension: { dimensionName: "date" } }],
          }),
          bericht(["sessionSourceMedium"], ["sessions", "totalUsers", "ecommercePurchases"], {
            ...absteigend("sessions"),
            limit: 10,
          }),
          bericht(["eventName"], ["totalUsers"], {
            dimensionFilter: {
              filter: { fieldName: "eventName", inListFilter: { values: [...TRICHTER] } },
            },
          }),
          bericht(["pagePath"], ["screenPageViews", "activeUsers"], {
            ...absteigend("screenPageViews"),
            limit: 10,
          }),
        ],
      }),
      frage<{ reports: Bericht[] }>("batchRunReports", {
        requests: [
          bericht(["sessionCampaignName"], ["sessions", "ecommercePurchases"], {
            ...absteigend("sessions"),
            limit: 10,
          }),
          bericht(["deviceCategory"], ["activeUsers"], absteigend("activeUsers")),
          bericht(["city"], ["activeUsers"], { ...absteigend("activeUsers"), limit: 8 }),
          bericht(["itemName"], ["itemsViewed", "itemsAddedToCart", "itemsPurchased", "itemRevenue"], {
            ...absteigend("itemsViewed"),
            limit: 10,
          }),
          bericht([], ["eventCount"], {
            dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "view_item" } } },
          }),
        ],
      }),
      frage<Bericht>("runRealtimeReport", { metrics: [{ name: "activeUsers" }] }).catch(() => null),
      // Eigener Abruf: Fehlt die Dimension „ziel“ in GA4, scheitert nur er.
      frage<Bericht>("runReport", bericht(["customEvent:ziel"], ["eventCount"], {
        ...absteigend("eventCount"),
        limit: 12,
        dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "klick" } } },
      })).catch(() => null),
    ]);

    const [kenn, verlauf, quellen, trichter, seiten] = a.reports;
    const [kampagnen, geraete, staedte, events, aufrufe] = b.reports;
    const k = zeilen(kenn)[0]?.m ?? [];

    const daten: GaUebersicht = {
      tage,
      kennzahlen: {
        besucher: k[0] ?? 0,
        neu: k[1] ?? 0,
        sitzungen: k[2] ?? 0,
        aufrufe: k[3] ?? 0,
        dauerSek: k[4] ?? 0,
        engagement: k[5] ?? 0,
        kaeufe: k[6] ?? 0,
        umsatz: k[7] ?? 0,
      },
      jetzt: echtzeit ? (zeilen(echtzeit)[0]?.m[0] ?? 0) : null,
      verlauf: zeilen(verlauf).map((z) => ({ tag: z.d[0], besucher: z.m[0] })),
      quellen: zeilen(quellen).map((z) => ({ name: z.d[0], sitzungen: z.m[0], besucher: z.m[1], kaeufe: z.m[2] })),
      trichter: Object.fromEntries(zeilen(trichter).map((z) => [z.d[0], z.m[0]])),
      seiten: zeilen(seiten).map((z) => ({ pfad: z.d[0], aufrufe: z.m[0], besucher: z.m[1] })),
      kampagnen: zeilen(kampagnen)
        .filter((z) => !["(not set)", "(direct)", "(organic)", "(referral)"].includes(z.d[0]))
        .map((z) => ({ name: z.d[0], sitzungen: z.m[0], kaeufe: z.m[1] })),
      geraete: zeilen(geraete).map((z) => ({ name: z.d[0], besucher: z.m[0] })),
      staedte: zeilen(staedte)
        .filter((z) => z.d[0] !== "(not set)")
        .map((z) => ({ name: z.d[0], besucher: z.m[0] })),
      events: zeilen(events)
        .filter((z) => z.d[0] !== "(not set)")
        .map((z) => ({ name: z.d[0], gesehen: z.m[0], gewaehlt: z.m[1], gekauft: z.m[2], umsatz: z.m[3] })),
      klicks: klicks ? zeilen(klicks).map((z) => ({ ziel: z.d[0], anzahl: z.m[0] })) : null,
      eventAufrufe: zeilen(aufrufe)[0]?.m[0] ?? 0,
    };

    const ergebnis: GaErgebnis = { ok: true, daten, abgerufen: new Date().toISOString() };
    ZWISCHENSPEICHER.set(tage, { bis: Date.now() + HALTEN_MS, ergebnis });
    return ergebnis;
  } catch (fehler) {
    const status = fehler instanceof GaFehler ? fehler.status : 0;
    const text = (fehler as Error).message;
    const meldung =
      status === 403 && /has not been used|is disabled|not been enabled/i.test(text)
        ? `Die „Google Analytics Data API“ ist im Google-Cloud-Projekt des Dienstkontos nicht aktiviert. In der Cloud Console unter „APIs & Dienste“ aktivieren, dann wenige Minuten warten. (${text})`
        : status === 403
          ? `Das Dienstkonto ${gaDienstkontoAdresse() ?? ""} darf die Property nicht lesen. In GA4 unter Verwaltung → Property-Zugriffsverwaltung als „Betrachter“ hinzufügen. (${text})`
          : /invalid_grant/i.test(text)
            ? `Google kennt das Dienstkonto ${gaDienstkontoAdresse() ?? ""} nicht, oder sein Schlüssel wurde gelöscht. GA_DIENSTKONTO_JSON in Vercel mit einer frischen Schlüsseldatei ersetzen. (${text})`
            : status === 400 && /customEvent|dimension/i.test(text)
              ? `GA4 kennt eine abgefragte Dimension nicht. (${text})`
              : text;
    console.error("[ga] Abruf fehlgeschlagen:", meldung);
    // Fehler nicht zwischenspeichern: Nach dem Freigeben soll es sofort gehen.
    return { ok: false, grund: "fehler", meldung };
  }
}
