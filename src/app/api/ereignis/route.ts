import { NextResponse } from "next/server";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { pruefeKuerzel } from "@/lib/promoter";

export const dynamic = "force-dynamic";

const ARTEN = [
  "seite",
  "event_gesehen",
  "ticket_gewaehlt",
  "kasse_begonnen",
  "daten_erfasst",
  "kauf_abgeschlossen",
  "vip_angefragt",
] as const;

/** Grobe Herkunft aus dem Referrer. Nur der Anbieter, nie die Adresse. */
function quelleAus(referrer: string | null, eigeneHost: string): string {
  if (!referrer) return "direkt";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (host === eigeneHost) return "intern";
    if (/instagram|ig\.me/.test(host)) return "instagram";
    if (/facebook|fb\./.test(host)) return "facebook";
    if (/google\./.test(host)) return "google";
    if (/tiktok/.test(host)) return "tiktok";
    if (/t\.co|twitter|x\.com/.test(host)) return "x";
    if (/whatsapp/.test(host)) return "whatsapp";
    return host.slice(0, 60);
  } catch {
    return "direkt";
  }
}

/** Sieht das nach einem Menschen aus? Grob, aber besser als nichts. */
function istBot(agent: string | null): boolean {
  if (!agent) return true;
  return /bot|crawl|spider|preview|fetch|monitor|lighthouse|headless/i.test(agent);
}

/**
 * Zählt ein Ereignis. Ohne Kennung, ohne IP, ohne Cookie.
 *
 * Deshalb gibt es hier auch nichts zu widerrufen und keinen
 * Einwilligungsdialog: Es wird niemand wiedererkannt, es wird nur
 * gezählt.
 */
export async function POST(anfrage: Request) {
  if (!datenbankVerbunden()) return NextResponse.json({ ok: false });

  // Bots verzerren die Konversion nach unten: Sie sehen Seiten an und
  // kaufen nie.
  if (istBot(anfrage.headers.get("user-agent"))) {
    return NextResponse.json({ ok: true, gezaehlt: false });
  }

  let koerper: {
    art?: string;
    eventId?: string | null;
    kampagne?: string | null;
    promo?: string | null;
    mobil?: boolean;
  };
  try {
    koerper = await anfrage.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!koerper.art || !ARTEN.includes(koerper.art as (typeof ARTEN)[number])) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const eigeneHost = new URL(anfrage.url).hostname.replace(/^www\./, "");

  const db = dienstClient();

  // Das Kürzel aus dem Link wird zum Promoter. Pausierte zählen nicht —
  // wie bei der Zuordnung von Bestellungen (ordne_promoter_zu).
  const kuerzel = pruefeKuerzel(koerper.promo);
  let promoterId: string | null = null;
  if (kuerzel) {
    const { data } = await db
      .from("promoter")
      .select("id")
      .eq("kuerzel", kuerzel)
      .eq("aktiv", true)
      .maybeSingle();
    promoterId = (data?.id as string | undefined) ?? null;
  }

  const { error } = await db.from("ereignisse").insert({
    promoter_id: promoterId,
    art: koerper.art,
    event_id: koerper.eventId ?? null,
    quelle: quelleAus(anfrage.headers.get("referer"), eigeneHost),
    kampagne: koerper.kampagne?.slice(0, 80) ?? null,
    geraet: koerper.mobil ? "mobil" : "rechner",
  });

  if (error) {
    // Eine verlorene Zählung ist folgenlos — sie darf nie eine Seite
    // stören.
    console.error("[ereignis] nicht gezählt:", error.message);
  }

  return NextResponse.json({ ok: true });
}
