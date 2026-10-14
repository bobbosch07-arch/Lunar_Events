"use server";

import { revalidatePath } from "next/cache";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { eigeneAdresse } from "@/lib/stripe";
import { sendeNamenNachfrage } from "@/lib/mail";

export type FehlendeNamen = {
  bestellungId: string;
  email: string;
  vorname: string | null;
  eventTitel: string;
  beginn: string;
  zugangstoken: string;
  fehlen: number;
  tickets: number;
};

async function istAdmin(): Promise<boolean> {
  // Mit dem Dienstschlüssel geht es weiter — also vorher die Rolle prüfen
  // (CLAUDE.md, "Personal-Anmeldungen gelten nur begrenzt").
  const sitzung = await serverClient();
  const { data } = await sitzung.rpc("ist_mitarbeiter", { mindestens: "admin" });
  return data === true;
}

/**
 * Bezahlte Bestellungen kommender Events, bei denen auf mindestens einem
 * gültigen Ticket der Name fehlt (0046) und die noch nicht angeschrieben
 * wurden. Nach 0046 entsteht so etwas nur noch aus Bestellungen davor: Die
 * Kasse lässt ohne Namen niemanden weiter. Abendkasse hat keine Namen.
 */
async function ladeFehlendeNamen(): Promise<FehlendeNamen[]> {
  const { data, error } = await dienstClient()
    .from("bestellungen")
    .select(
      `id, zugangstoken,
       kunde:kunden(email, vorname),
       event:events!inner(titel, beginn),
       tickets(status, gast_name)`,
    )
    .eq("status", "bezahlt")
    .eq("abendkasse", false)
    .is("nachbuchung_zu", null)
    .is("namen_mail_am", null)
    .gt("event.beginn", new Date().toISOString())
    .order("erstellt_am");
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((b) => {
    const tickets = ((b.tickets ?? []) as Array<{ status: string; gast_name: string | null }>).filter(
      (t) => t.status === "gueltig",
    );
    const fehlen = tickets.filter((t) => !t.gast_name).length;
    const kunde = b.kunde as unknown as { email: string | null; vorname: string | null } | null;
    const event = b.event as unknown as { titel: string; beginn: string };
    if (fehlen === 0 || !kunde?.email) return [];
    return [
      {
        bestellungId: b.id as string,
        email: kunde.email,
        vorname: kunde.vorname,
        eventTitel: event.titel,
        beginn: event.beginn,
        zugangstoken: b.zugangstoken as string,
        fehlen,
        tickets: tickets.length,
      },
    ];
  });
}

/** Wie viele Bestellungen auf eine Nachfrage warten — für das Banner. */
export async function zaehleFehlendeNamen(): Promise<number> {
  if (!(await istAdmin())) return 0;
  try {
    return (await ladeFehlendeNamen()).length;
  } catch (fehler) {
    console.error("[namen] Zählen fehlgeschlagen:", (fehler as Error).message);
    return 0;
  }
}

/**
 * Backoffice: jede dieser Bestellungen einmal anschreiben (`namen_mail_am`).
 * Hört beim ersten Fehlschlag auf, wie „Alle nachsenden“: Scheitert eine,
 * scheitern meist alle, und der Grund soll sofort sichtbar sein.
 */
export async function frageNamenNach(): Promise<
  { ok: true; verschickt: number; offen: number } | { ok: false; grund: string; verschickt: number }
> {
  if (!(await istAdmin())) return { ok: false, grund: "Nur für Admins.", verschickt: 0 };

  let offene: FehlendeNamen[];
  try {
    offene = await ladeFehlendeNamen();
  } catch (fehler) {
    return { ok: false, grund: (fehler as Error).message, verschickt: 0 };
  }

  const db = dienstClient();
  let verschickt = 0;
  for (const b of offene.slice(0, 40)) {
    const wann = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(b.beginn));

    const ergebnis = await sendeNamenNachfrage({
      an: b.email,
      vorname: b.vorname,
      eventTitel: b.eventTitel,
      wann: `${wann} Uhr`,
      fehlen: b.fehlen,
      tickets: b.tickets,
      ticketLink: `${eigeneAdresse()}/tickets/${b.zugangstoken}`,
    });
    if (!ergebnis.ok) {
      revalidatePath("/backoffice/bestellungen");
      return { ok: false, grund: ergebnis.grund, verschickt };
    }
    await db
      .from("bestellungen")
      .update({ namen_mail_am: new Date().toISOString() })
      .eq("id", b.bestellungId);
    verschickt += 1;
  }

  revalidatePath("/backoffice/bestellungen");
  return { ok: true, verschickt, offen: Math.max(0, offene.length - verschickt) };
}
