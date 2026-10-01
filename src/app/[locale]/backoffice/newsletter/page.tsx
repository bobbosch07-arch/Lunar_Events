import type { Metadata } from "next";
import { getFormatter, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { BackofficeKopf } from "@/components/BackofficeKopf";
import { BackofficeSkelett } from "@/components/BackofficeSkelett";
import {
  AbonnentEntfernen,
  AusgabeFortsetzen,
  NewsletterVerfassen,
} from "@/components/NewsletterVerwaltung";
import { serverClient } from "@/lib/supabase/server";
import css from "../backoffice.module.css";

export const metadata: Metadata = {
  title: "Newsletter",
  robots: { index: false, follow: false },
};

export default async function NewsletterSeite({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <BackofficeKopf titel="Newsletter" />
      <Suspense fallback={<BackofficeSkelett kacheln={3} zeilen={6} />}>
        <Inhalt />
      </Suspense>
    </>
  );
}

type Abo = {
  email: string;
  bestaetigt: boolean;
  bestaetigt_am: string | null;
  abgemeldet_am: string | null;
  erstellt_am: string;
};

async function Inhalt() {
  const db = await serverClient();
  const [abos, ausgaben, events, f] = await Promise.all([
    db
      .from("newsletter")
      .select("email, bestaetigt, bestaetigt_am, abgemeldet_am, erstellt_am")
      .order("erstellt_am", { ascending: false })
      .limit(500),
    db
      .from("newsletter_ausgaben")
      .select("id, betreff, erstellt_am, abgeschlossen_am, event:events(titel), newsletter_zustellungen(count)")
      .order("erstellt_am", { ascending: false })
      .limit(30),
    db
      .from("events")
      .select("id, titel, beginn")
      .eq("status", "veroeffentlicht")
      .gte("beginn", new Date().toISOString())
      .order("beginn"),
    getFormatter(),
  ]);

  const liste = (abos.data ?? []) as Abo[];
  const bestaetigt = liste.filter((a) => a.bestaetigt && !a.abgemeldet_am).length;
  const wartet = liste.filter((a) => !a.bestaetigt && !a.abgemeldet_am).length;
  const abgemeldet = liste.filter((a) => a.abgemeldet_am).length;

  const kacheln: Array<[string, number, string]> = [
    ["Bestätigt", bestaetigt, "bekommen den Newsletter"],
    ["Wartet", wartet, "Bestätigungslink noch nicht geklickt"],
    ["Abgemeldet", abgemeldet, "bekommen nichts mehr"],
  ];

  return (
    <>
      <div className={css.kennzahlen}>
        {kacheln.map(([name, wert, zusatz]) => (
          <div key={name} className={css.kachel}>
            <span className={css.kachelName}>{name}</span>
            <span className={css.kachelWert}>{wert}</span>
            <span className={css.kachelZusatz}>{zusatz}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <NewsletterVerfassen
          empfaenger={bestaetigt}
          events={(events.data ?? []).map((e) => ({
            id: e.id as string,
            name: `${e.titel} · ${f.dateTime(new Date(e.beginn as string), "kurz")}`,
          }))}
        />
      </div>

      {(ausgaben.data ?? []).length > 0 ? (
        <>
          <h2 className={css.seitentitel} style={{ fontSize: "1.25rem", marginTop: "2.5rem" }}>
            Verschickt
          </h2>
          <div className={css.tabellenfeld}>
            <table className={css.tabelle}>
              <thead>
                <tr>
                  <th>Betreff</th>
                  <th>Event</th>
                  <th className={css.zahl}>Empfänger</th>
                  <th>Wann</th>
                  <th>Stand</th>
                </tr>
              </thead>
              <tbody>
                {(ausgaben.data ?? []).map((a) => {
                  const zahl =
                    ((a.newsletter_zustellungen as unknown as Array<{ count: number }>)?.[0]?.count) ?? 0;
                  const event = a.event as unknown as { titel: string } | null;
                  return (
                    <tr key={a.id as string}>
                      <td className={css.haupt}>{a.betreff as string}</td>
                      <td className={css.nebensache}>{event?.titel ?? "—"}</td>
                      <td className={css.zahl}>{zahl}</td>
                      <td className={css.nebensache}>
                        {f.dateTime(new Date(a.erstellt_am as string), "kurz")}
                      </td>
                      <td>
                        {a.abgeschlossen_am ? (
                          <span className={`${css.marke_} ${css.gut}`}>fertig</span>
                        ) : (
                          <>
                            <span className={`${css.marke_} ${css.warte}`}>unterbrochen</span>
                            <div style={{ marginTop: 8 }}>
                              <AusgabeFortsetzen ausgabeId={a.id as string} />
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2 className={css.seitentitel} style={{ fontSize: "1.25rem", marginTop: "2.5rem" }}>
        Adressen
      </h2>
      <div className={css.tabellenfeld}>
        <table className={css.tabelle}>
          <thead>
            <tr>
              <th>Adresse</th>
              <th>Stand</th>
              <th>Eingetragen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 ? (
              <tr>
                <td colSpan={4} className={css.leer}>
                  Noch niemand eingetragen.
                </td>
              </tr>
            ) : (
              liste.map((a) => (
                <tr key={a.email}>
                  <td className={css.haupt}>{a.email}</td>
                  <td>
                    {a.abgemeldet_am ? (
                      <span className={`${css.marke_} ${css.neutral}`}>abgemeldet</span>
                    ) : a.bestaetigt ? (
                      <span className={`${css.marke_} ${css.gut}`}>bestätigt</span>
                    ) : (
                      <span className={`${css.marke_} ${css.warte}`}>wartet</span>
                    )}
                  </td>
                  <td className={css.nebensache}>{f.dateTime(new Date(a.erstellt_am), "kurz")}</td>
                  <td>
                    <AbonnentEntfernen email={a.email} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className={css.notiz}>
        Auf der Liste steht erst, wer den Link in der Bestätigungsmail angeklickt hat (Double-Opt-in).
        „Wartet“ heißt: eingetragen, aber nie bestätigt. Diese Adressen bekommen nichts.
        „Entfernen“ löscht eine Adresse endgültig, etwa wenn jemand das verlangt.
        Brevo verschickt im kostenlosen Tarif 300 Mails am Tag; bricht ein Versand ab, geht er
        mit „Fortsetzen“ am nächsten Tag weiter, ohne dass jemand eine Mail doppelt bekommt.
      </p>
    </>
  );
}
