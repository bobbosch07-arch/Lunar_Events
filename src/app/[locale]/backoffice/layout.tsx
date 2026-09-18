import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { mitZweitemFaktor, sitzungAbgelaufen, zweiFaktorPflicht } from "@/lib/sitzung";
import { darfBackoffice, darfScannen, istRolle, ROLLEN_NAMEN } from "@/lib/rollen";
import { ZweiFaktor } from "@/components/ZweiFaktor";
import { SPAETER_COOKIE } from "@/lib/passwort";
import { setRequestLocale } from "next-intl/server";
import { Anmeldung } from "@/components/Anmeldung";
import { BackofficeReiter } from "@/components/BackofficeReiter";
import { Logo } from "@/components/Logo";
import { Link } from "@/i18n/navigation";
import { holeAngemeldeten } from "@/lib/konto";
import { serverClient } from "@/lib/supabase/server";
import css from "./backoffice.module.css";

/**
 * Rahmen und Rechteprüfung fürs gesamte Backoffice.
 *
 * Das stand bis dahin in einer Komponente, die *jede* Seite selbst
 * aufrief. Damit lief bei jedem Reiterwechsel wieder alles von vorn:
 * Sitzung beim Auth-Server nachprüfen, Mitarbeiterzeile laden, Kopf neu
 * aufbauen — zwei zusätzliche Netzwerkrunden, bevor die eigentliche
 * Abfrage überhaupt begann.
 *
 * Als Layout bleibt der Rahmen beim Wechsel zwischen den Reitern stehen
 * und wird nicht neu gerechnet. Next lädt dann nur noch den Teil, der
 * sich wirklich ändert.
 */
export default async function BackofficeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const angemeldet = await holeAngemeldeten();

  if (!angemeldet) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <Anmeldung weiter="/backoffice" mitPasswort />
      </main>
    );
  }

  const db = await serverClient();
  const { data: mitarbeiter } = await db
    .from("mitarbeiter")
    .select("name, rolle, aktiv")
    .eq("user_id", angemeldet.id)
    .maybeSingle();

  const rolle =
    mitarbeiter?.aktiv && istRolle(mitarbeiter.rolle) ? mitarbeiter.rolle : null;

  // Zahlen, Bestellungen und Kundendaten sehen nur Admins (17.09.2026). Alle
  // anderen Rollen sind fürs Event da, nicht fürs Büro.
  if (!rolle || !darfBackoffice(rolle)) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <p className={css.torText}>
          {rolle
            ? `Dieses Konto ist als ${ROLLEN_NAMEN[rolle]} freigeschaltet, nicht fürs Backoffice.`
            : `Dieses Konto (${angemeldet.email}) hat keinen Zugang zum Backoffice.`}
        </p>
        {rolle && darfScannen(rolle) ? (
          <Link href="/einlass" style={{ color: "#E4CE98" }}>
            Zum Einlass-Scanner
          </Link>
        ) : rolle === "garderobe" ? (
          <Link href="/garderobe" style={{ color: "#E4CE98" }}>
            Zur Garderobe
          </Link>
        ) : null}
      </main>
    );
  }

  // Älter als erlaubt: abmelden und neu anmelden lassen. Die Datenbank
  // würde die Daten ohnehin verweigern — ohne diesen Schritt sähe man nur
  // leere Seiten.
  if (await sitzungAbgelaufen(rolle)) {
    redirect("/auth/abmelden?weiter=/backoffice");
  }

  // Zweiter Faktor. Solange die Pflicht noch nicht scharf ist, lässt sich
  // die Einrichtung vertagen — sonst stünde hier eine Wand, bevor überhaupt
  // jemand einrichten konnte.
  const [zweiterFaktor, pflicht, kekse] = await Promise.all([
    mitZweitemFaktor(),
    zweiFaktorPflicht(),
    cookies(),
  ]);
  if (!zweiterFaktor && (pflicht || !kekse.get(SPAETER_COOKIE))) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <ZweiFaktor art="tor" pflicht={pflicht} />
      </main>
    );
  }

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <div className={css.kopfReihe}>
            <span className={css.marke}>
              <Logo ton="ivory" hoehe={30} />
              Backoffice
            </span>
            <BackofficeReiter />
          </div>
        </div>
      </header>

      <main className={css.inhalt}>
        <div className="seitenbreite">{children}</div>
      </main>
    </div>
  );
}
