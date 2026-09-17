import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Anmeldung } from "@/components/Anmeldung";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { holeAngemeldeten } from "@/lib/konto";
import { darfScannen, istRolle, ROLLEN_NAMEN } from "@/lib/rollen";
import { dienstClient, serverClient } from "@/lib/supabase/server";
import { schichtStand, schichtStunden, type Schicht } from "@/lib/typen";
import css from "../promoter/[token]/promoter.module.css";

export const metadata: Metadata = {
  title: "Mein Plan",
  robots: { index: false, follow: false },
};

type Zeile = Schicht & { event: { titel: string; beginn: string; ort: string } };

/**
 * „Mein Plan" — die eigenen Schichten (Migration 0023). Dafür meldet sich
 * das Personal überhaupt an (Fragebogen 16.09.2026).
 *
 * Gelesen wird mit dem Dienstschlüssel, nachdem die Rolle geprüft ist: Die
 * eigenen Schichten wären über die Zugriffsregeln zwar sichtbar, das Event
 * dahinter aber nicht, solange es noch ein Entwurf ist — geplant wird meist
 * vor dem Veröffentlichen.
 */
export default async function MeinPlan({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const angemeldet = await holeAngemeldeten();
  if (!angemeldet) {
    return (
      <Rahmen>
        <div className={css.kopfzeile}>
          <h1 className={css.titel}>Mein Plan</h1>
          <p className={css.intro}>
            Melde dich an, dann siehst du deine Schichten. Wir schicken dir einen Link per Mail.
          </p>
        </div>
        <Anmeldung weiter="/plan" />
      </Rahmen>
    );
  }

  const sitzung = await serverClient();
  const [{ data: gehoertDazu }, { data: person }] = await Promise.all([
    sitzung.rpc("ist_mitarbeiter", { mindestens: "personal" }),
    sitzung.from("mitarbeiter").select("name, rolle, aktiv").eq("user_id", angemeldet.id).maybeSingle(),
  ]);

  if (gehoertDazu !== true || !person?.aktiv) {
    return (
      <Rahmen>
        <div className={css.kopfzeile}>
          <h1 className={css.titel}>Mein Plan</h1>
          <p className={css.intro}>
            Dieses Konto ({angemeldet.email}) gehört nicht zum Team. Bist du das doch, melde
            dich bei der Veranstaltungsleitung.
          </p>
        </div>
        <Link href="/" className={css.abschnittText}>
          Zur Startseite
        </Link>
      </Rahmen>
    );
  }

  const rolle = istRolle(person.rolle) ? person.rolle : null;

  const { data: roh } = await dienstClient()
    .from("schichten")
    .select("*, event:events(titel, beginn, ort:orte(name, stadt))")
    .eq("user_id", angemeldet.id)
    .order("beginn", { ascending: true });

  const zeilen: Zeile[] = (roh ?? []).map((s) => {
    const e = s.event as unknown as {
      titel: string;
      beginn: string;
      ort: { name: string; stadt: string } | null;
    };
    return {
      ...(s as unknown as Schicht),
      event: {
        titel: e?.titel ?? "",
        beginn: e?.beginn ?? (s.beginn as string),
        ort: e?.ort ? `${e.ort.name}, ${e.ort.stadt}` : "",
      },
    };
  });

  const jetzt = Date.now();
  const kommende = zeilen.filter((z) => new Date(z.ende).getTime() >= jetzt);
  const frueher = zeilen
    .filter((z) => new Date(z.ende).getTime() < jetzt)
    .sort((a, b) => b.beginn.localeCompare(a.beginn));
  const stundenGesamt = frueher.reduce((s, z) => s + schichtStunden(z), 0);

  return (
    <Rahmen>
      <div className={css.kopfzeile}>
        <span className="eyebrow">{rolle ? ROLLEN_NAMEN[rolle] : "Team"}</span>
        <h1 className={css.titel}>Hallo {(person.name as string).split(" ")[0]}</h1>
        <p className={css.intro}>
          {kommende.length === 0
            ? "Für dich ist gerade keine Schicht eingetragen. Sobald eingeteilt wird, steht sie hier — und du bekommst eine Mail."
            : `${kommende.length === 1 ? "Eine Schicht steht" : `${kommende.length} Schichten stehen`} an. Hier steht immer der aktuelle Stand — auch wenn sich nach der Mail etwas ändert.`}
        </p>
      </div>

      {kommende.length > 0 ? (
        <section className={css.abschnitt}>
          <h2 className={css.abschnittTitel}>Kommt</h2>
          {kommende.map((z) => (
            <SchichtKarte key={z.id} zeile={z} />
          ))}
        </section>
      ) : null}

      {frueher.length > 0 ? (
        <section className={css.abschnitt}>
          <h2 className={css.abschnittTitel}>Gearbeitet</h2>
          <p className={css.abschnittText}>
            {stundenGesamt.toFixed(2).replace(".", ",")} Stunden insgesamt. Gezählt wird, was am
            Abend ein- und ausgecheckt wurde; ohne das die geplante Zeit, Pause immer abgezogen.
          </p>
          <ul className={css.zeilen}>
            {frueher.slice(0, 20).map((z) => (
              <li key={z.id} className={css.zeile}>
                <div className={css.zeileEvent}>
                  <span className={css.zeileTitel}>{z.event.titel}</span>
                  <span className={css.zeileDatum}>
                    {datum(z.beginn)} · {ROLLEN_NAMEN[z.rolle]}
                    {z.station ? ` · ${z.station}` : ""}
                  </span>
                </div>
                <span className={css.zahl}>{schichtStunden(z).toFixed(2).replace(".", ",")}</span>
                <span className={css.zahl}>Std</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rolle && darfScannen(rolle) ? (
        <Link href="/einlass" className={css.abschnittText}>
          Zum Scanner
        </Link>
      ) : null}
    </Rahmen>
  );
}

function SchichtKarte({ zeile }: { zeile: Zeile }) {
  const lage = schichtStand(zeile);
  return (
    <div className={css.linkKarte}>
      <div className={css.linkKopf}>
        <span className={css.linkTitel}>{zeile.event.titel}</span>
        <span className={css.linkDatum}>
          {datum(zeile.beginn)} – {uhrzeit(zeile.ende)} Uhr
          {zeile.pause_min > 0 ? ` · ${zeile.pause_min} Min Pause` : ""}
        </span>
      </div>
      <p className={css.linkCode}>
        <strong>{ROLLEN_NAMEN[zeile.rolle]}</strong>
        {zeile.station ? ` · ${zeile.station}` : ""}
        {zeile.event.ort ? ` · ${zeile.event.ort}` : ""}
      </p>
      {zeile.notiz ? <p className={css.abschnittText}>{zeile.notiz}</p> : null}
      {lage !== "geplant" ? (
        <p className={css.abschnittText}>
          {lage === "laeuft" ? "Eingecheckt" : "Fertig"} ·{" "}
          {schichtStunden(zeile).toFixed(2).replace(".", ",")} Stunden
        </p>
      ) : null}
    </div>
  );
}

function datum(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
}

function uhrzeit(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(iso));
}

function Rahmen({ children }: { children: React.ReactNode }) {
  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="navy" hoehe={40} prioritaet />
          </Link>
        </div>
      </header>
      <main className={`seitenbreite ${css.inhalt}`}>{children}</main>
    </div>
  );
}
