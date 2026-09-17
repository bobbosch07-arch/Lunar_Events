import { dienstClient, datenbankVerbunden } from "./supabase/server";
import { sendeAnmeldungImBackoffice, versandEingerichtet } from "./mail";

/**
 * Meldet den Admins, wenn sich jemand mit Admin-Rechten anmeldet
 * (Fragebogen 16.09.2026, Umfang entschieden 17.09.2026).
 *
 * Bewusst nur Admins: An einem Eventabend melden sich zwanzig Leute an —
 * jede dieser Mails ginge vom Brevo-Tageslimit ab, das die Tickets
 * brauchen. Wer an Geld und Kundendaten kommt, ist die Meldung wert.
 *
 * Scheitert der Versand, scheitert nie die Anmeldung: Diese Funktion wirft
 * nicht und gibt nichts zurück, was einen Ablauf aufhalten könnte.
 */
export async function meldeAnmeldung(userId: string, weg: "Passwort" | "Anmeldelink") {
  try {
    if (!datenbankVerbunden() || !versandEingerichtet()) return;

    const db = dienstClient();
    const { data: person } = await db
      .from("mitarbeiter")
      .select("name, rolle, aktiv")
      .eq("user_id", userId)
      .maybeSingle();
    if (!person?.aktiv || person.rolle !== "admin") return;

    const { data: admins } = await db
      .from("mitarbeiter")
      .select("user_id")
      .eq("rolle", "admin")
      .eq("aktiv", true);

    const { data: konten } = await db.auth.admin.listUsers({ perPage: 1000 });
    const adressen = (admins ?? [])
      .map((a) => konten?.users.find((u) => u.id === (a.user_id as string))?.email)
      .filter((e): e is string => Boolean(e));
    if (adressen.length === 0) return;

    const wer = konten?.users.find((u) => u.id === userId)?.email ?? "unbekannt";
    const zeit = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());

    await Promise.all(
      adressen.map((an) =>
        sendeAnmeldungImBackoffice({
          an,
          name: person.name as string,
          email: wer,
          weg,
          zeit,
        }),
      ),
    );
  } catch (fehler) {
    console.error("[anmeldung] Meldung fehlgeschlagen:", (fehler as Error).message);
  }
}
