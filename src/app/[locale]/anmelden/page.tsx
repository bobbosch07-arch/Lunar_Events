import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Logo } from "@/components/Logo";
import css from "./anmelden.module.css";

export const metadata: Metadata = {
  title: "Anmelden",
  robots: { index: false, follow: false },
};

/**
 * Zwischenseite für ausgestellte Anmeldelinks.
 *
 * Ein Anmeldelink gilt genau einmal. Schickt man ihn per WhatsApp oder
 * iMessage, ruft der Messenger die Adresse für die Vorschau selbst ab —
 * und verbraucht ihn, bevor die Person tippt. Genau das ist beim ersten
 * Backoffice-Zugang passiert.
 *
 * Diese Seite löst nichts ein. Erst der Knopf führt zu
 * `/auth/bestaetigen`; Vorschauen rufen nur die Adresse aus der
 * Nachricht ab und folgen keinen Links darin.
 */
export default async function Anmelden({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token_hash?: string; type?: string; weiter?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token_hash, type, weiter } = await searchParams;

  const ziel = new URLSearchParams();
  if (token_hash) ziel.set("token_hash", token_hash);
  ziel.set("type", type ?? "magiclink");
  if (weiter) ziel.set("weiter", weiter);

  return (
    <main className={css.seite}>
      <Logo ton="ivory" hoehe={64} />
      {token_hash ? (
        <>
          <p className={css.text}>Dein Zugang zu Lunar Events ist bereit.</p>
          <a className={css.knopf} href={`/auth/bestaetigen?${ziel.toString()}`}>
            Jetzt anmelden
          </a>
          <p className={css.klein}>Der Link gilt eine Stunde und nur einmal.</p>
        </>
      ) : (
        <p className={css.text}>Dieser Link ist unvollständig.</p>
      )}
    </main>
  );
}
