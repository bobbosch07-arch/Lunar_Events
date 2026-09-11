import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Anmeldung } from "./Anmeldung";
import { Logo } from "./Logo";
import { holeAngemeldeten } from "@/lib/konto";
import { serverClient } from "@/lib/supabase/server";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

const ZIELE = [
  { href: "/backoffice", name: "Übersicht" },
  { href: "/backoffice/events", name: "Events" },
  { href: "/backoffice/bestellungen", name: "Bestellungen" },
  { href: "/backoffice/vip", name: "VIP" },
  { href: "/backoffice/auswertung", name: "Auswertung" },
] as const;

export type Rolle = "admin" | "team" | "einlass";

/**
 * Wacht über den gesamten Backoffice-Bereich und liefert den Rahmen.
 * Die Rechteprüfung steht hier einmal, statt auf jeder Unterseite
 * wiederholt zu werden — vergessen kann man sie so nicht.
 */
export async function BackofficeRahmen({
  aktiv,
  titel,
  kopfzusatz,
  children,
}: {
  aktiv: string;
  titel: string;
  kopfzusatz?: ReactNode;
  children: ReactNode;
}) {
  const angemeldet = await holeAngemeldeten();

  if (!angemeldet) {
    return (
      <main className={css.tor}>
        <Logo ton="ivory" hoehe={64} />
        <Anmeldung weiter="/backoffice" />
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

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <div className={css.kopfReihe}>
            <span className={css.marke}>
              <Logo ton="ivory" hoehe={30} />
              Backoffice
            </span>
            <nav className={css.reiter}>
              {ZIELE.map((z) => (
                <Link
                  key={z.href}
                  href={z.href}
                  className={z.href === aktiv ? css.reiterAktiv : undefined}
                >
                  {z.name}
                </Link>
              ))}
              <Link href="/einlass">Einlass</Link>
              <Link href="/">Zur Website</Link>
            </nav>
          </div>
        </div>
      </header>

      <main className={css.inhalt}>
        <div className="seitenbreite">
          <div className={css.zeile}>
            <h1 className={css.seitentitel}>{titel}</h1>
            {kopfzusatz}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
