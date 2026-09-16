import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { sitzungAbgelaufen } from "@/lib/sitzung";
import { setRequestLocale } from "next-intl/server";
import { Anmeldung } from "@/components/Anmeldung";
import { BackofficeReiter } from "@/components/BackofficeReiter";
import { Logo } from "@/components/Logo";
import { Link } from "@/i18n/navigation";
import { holeAngemeldeten } from "@/lib/konto";
import { serverClient } from "@/lib/supabase/server";
import css from "./backoffice.module.css";

export type Rolle = "admin" | "team" | "einlass";

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

  const rolle = mitarbeiter?.aktiv ? (mitarbeiter.rolle as Rolle) : null;

  // Einlasspersonal darf scannen, aber keine Zahlen sehen — das ist eine
  // andere Vertrauensstufe.
  if (rolle !== "admin" && rolle !== "team") {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <p className={css.torText}>
          {rolle === "einlass"
            ? "Dieses Konto ist fürs Einlasspersonal freigeschaltet, nicht fürs Backoffice."
            : `Dieses Konto (${angemeldet.email}) hat keinen Zugang zum Backoffice.`}
        </p>
        {rolle === "einlass" ? (
          <Link href="/einlass" style={{ color: "#E4CE98" }}>
            Zum Einlass-Scanner
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
