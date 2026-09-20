"use server";

import { darfMailSchicken } from "@/lib/drossel";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import { sendeNewsletterBestaetigung, versandEingerichtet } from "@/lib/mail";
import { eigeneAdresse } from "@/lib/stripe";

export type NewsletterErgebnis =
  | { ok: true }
  | { ok: false; fehler: "email" | "kein_versand" | "unbekannt" };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * Trägt eine Adresse in den Verteiler ein und schickt die Bestätigungsmail
 * (Double Opt-in, C7). Auf der Liste steht erst, wer den Link darin anklickt
 * (`bestaetige_newsletter`); vorher ist die Zeile nur ein Vormerker.
 *
 * Antwortet auch mit „ok", wenn die Adresse schon bestätigt drinsteht — wer
 * anders antwortet, verrät, welche Adressen bekannt sind. Dann geht keine
 * zweite Mail raus.
 */
export async function trageInVerteilerEin(
  email: string,
): Promise<NewsletterErgebnis> {
  const adresse = email.trim().toLowerCase();
  if (!EMAIL.test(adresse) || adresse.length > 200) {
    return { ok: false, fehler: "email" };
  }
  if (!datenbankVerbunden()) return { ok: false, fehler: "unbekannt" };
  // Ohne Mailversand gibt es keine Bestätigung — dann lieber gleich sagen,
  // dass es nicht geht, statt still eine unbestätigte Adresse abzulegen.
  if (!versandEingerichtet()) return { ok: false, fehler: "kein_versand" };
  // Gegen Skripte, die den Verteiler mit fremden Adressen fluten (0032).
  if (!(await darfMailSchicken("newsletter", adresse))) return { ok: true };

  const db = dienstClient();
  const { data: vorhanden } = await db
    .from("newsletter")
    .select("token, bestaetigt, abgemeldet_am")
    .eq("email", adresse)
    .maybeSingle();

  // Schon bestätigt und nicht abgemeldet: nichts tun, still „ok".
  if (vorhanden?.bestaetigt && !vorhanden.abgemeldet_am) return { ok: true };

  let token = vorhanden?.token as string | undefined;
  if (!vorhanden) {
    const { data: neu, error } = await db
      .from("newsletter")
      .insert({ email: adresse })
      .select("token")
      .single();
    if (error || !neu) {
      console.error("[newsletter] Eintragen fehlgeschlagen:", error?.message);
      return { ok: false, fehler: "unbekannt" };
    }
    token = neu.token as string;
  } else if (vorhanden.abgemeldet_am) {
    // Wer sich abgemeldet hatte, meldet sich neu an: den Vermerk lösen,
    // aber erst der Klick bestätigt wieder.
    await db.from("newsletter").update({ abgemeldet_am: null }).eq("email", adresse);
  }

  const ok = await sendeNewsletterBestaetigung({
    an: adresse,
    link: `${eigeneAdresse()}/newsletter/bestaetigen/${token}`,
  });
  if (!ok) return { ok: false, fehler: "unbekannt" };

  return { ok: true };
}

/** Der Klick auf den Bestätigungslink aus der Mail. */
export async function bestaetigeNewsletter(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !/^[0-9a-f]{16,128}$/.test(token)) return { ok: false };
  const { data, error } = await dienstClient().rpc("bestaetige_newsletter", { p_token: token });
  if (error) console.error("[newsletter] Bestätigen fehlgeschlagen:", error.message);
  return { ok: data === true };
}

/** Der Klick auf den Abmeldelink. */
export async function meldeNewsletterAb(token: string): Promise<{ ok: boolean }> {
  if (!datenbankVerbunden() || !/^[0-9a-f]{16,128}$/.test(token)) return { ok: false };
  const { data, error } = await dienstClient().rpc("melde_newsletter_ab", { p_token: token });
  if (error) console.error("[newsletter] Abmelden fehlgeschlagen:", error.message);
  return { ok: data === true };
}
