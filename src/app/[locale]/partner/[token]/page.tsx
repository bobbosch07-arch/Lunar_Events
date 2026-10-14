import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/Logo";
import { dienstClient, datenbankVerbunden } from "@/lib/supabase/server";
import css from "./partner.module.css";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = {
  title: "Partner",
  robots: { index: false, follow: false, nocache: true },
  // Der Schlüssel steht in der Adresse. Ohne das reiste er beim Klick auf
  // einen Link als Herkunft mit.
  referrer: "no-referrer",
};

/**
 * Was Geschäftspartner hinter dem Partnerlink eines Events sehen (0047):
 * die bezahlten Online-Bestellungen mit Namen des Käufers und Zahl der
 * Tickets. Keine Mailadressen, keine Beträge, keine Abendkasse, Gästeliste
 * oder VIP (Wunsch Bobbo, 14.10.2026). Ohne Anmeldung, wie Ticket- und
 * Promoter-Link; die Tabelle mit den Schlüsseln liest nur der Dienstschlüssel.
 */
export default async function PartnerSeite({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  if (!datenbankVerbunden() || !/^[0-9a-f]{64}$/.test(token)) notFound();

  const db = dienstClient();
  const { data: zugang } = await db
    .from("partner_links")
    .select("event:events(id, titel, beginn, status, ort:orte(name, stadt))")
    .eq("token", token)
    .maybeSingle();
  const event = zugang?.event as unknown as {
    id: string;
    titel: string;
    beginn: string;
    status: string;
    ort: { name: string; stadt: string } | null;
  } | null;
  if (!event) notFound();

  // Bezahlt, online (keine Abendkasse), keine Garderoben-Nachbuchung. Gezählt
  // werden Tickets, die nicht storniert sind; eine ganz erstattete Bestellung
  // fällt damit heraus.
  const { data: roh } = await db
    .from("bestellungen")
    .select(
      `id, bezahlt_am, kunde:kunden(vorname, nachname), promoter:promoter(name),
       tickets(id, status, phase_name, fastlane, gast_name, erstellt_am)`,
    )
    .eq("event_id", event.id)
    .eq("status", "bezahlt")
    .eq("abendkasse", false)
    .is("nachbuchung_zu", null)
    .order("bezahlt_am", { ascending: false })
    .limit(2000);

  const [t, f] = await Promise.all([getTranslations("partner"), getFormatter()]);

  const zeilen = (roh ?? []).flatMap((b) => {
    const gueltig = (
      (b.tickets ?? []) as Array<{
        id: string;
        status: string;
        phase_name: string;
        fastlane: boolean;
        gast_name: string | null;
        erstellt_am: string;
      }>
    )
      .filter((x) => x.status !== "storniert")
      // Wie auf der Ticketseite: bei gleichem Zeitstempel (vor 0046) die ID.
      .sort((x, y) => x.erstellt_am.localeCompare(y.erstellt_am) || x.id.localeCompare(y.id));
    if (gueltig.length === 0) return [];
    const kunde = b.kunde as unknown as { vorname: string | null; nachname: string | null } | null;
    const name = [kunde?.vorname, kunde?.nachname].filter(Boolean).join(" ");
    // Namen auf den Tickets (0046), soweit eingetragen. Steht dort nur der
    // Käufer selbst, sagt die Zeile nichts Neues und entfällt.
    const namen = gueltig.map((x) => x.gast_name).filter((n): n is string => Boolean(n));
    const zeigeNamen = namen.some(
      (n) => n.toLocaleLowerCase("de") !== name.toLocaleLowerCase("de"),
    );
    const promoter = (b.promoter as unknown as { name: string } | null)?.name ?? null;
    // Welche Tickets: meist eine Phase ("Early Bird"); stecken mehrere in
    // einer Bestellung, mit Anzahl ("2× Early Bird, 1× Phase 2").
    const phasen = new Map<string, number>();
    for (const x of gueltig) phasen.set(x.phase_name, (phasen.get(x.phase_name) ?? 0) + 1);
    const art =
      phasen.size === 1
        ? [...phasen.keys()][0]
        : [...phasen].map(([p, n]) => `${n}× ${p}`).join(", ");
    const fastlane = gueltig.some((x) => x.fastlane);
    return [
      {
        id: b.id as string,
        name,
        tickets: gueltig.length,
        art,
        fastlane,
        namen: zeigeNamen ? namen : [],
        promoter,
      },
    ];
  });
  const summe = zeilen.reduce((s, z) => s + z.tickets, 0);

  return (
    <div className={css.rahmen}>
      <header className={css.kopf}>
        <div className="seitenbreite">
          <Link href="/" aria-label="Lunar Events">
            <Logo ton="farbig" hoehe={44} prioritaet />
          </Link>
        </div>
      </header>

      <main className={`seitenbreite ${css.inhalt}`}>
        <div className={css.kopfzeile}>
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className={css.titel}>{event.titel}</h1>
          <p className={css.wann}>
            {f.dateTime(new Date(event.beginn), "mitZeit")}
            {event.ort ? ` · ${event.ort.name}, ${event.ort.stadt}` : ""}
          </p>
          <p className={css.intro}>{t("intro")}</p>
        </div>

        {event.status === "abgesagt" ? <p className={css.abgesagt}>{t("abgesagt")}</p> : null}

        <div className={css.summen}>
          <div className={css.summe}>
            <span className={css.summeName}>{t("tickets")}</span>
            <span className={css.summeWert}>{summe}</span>
          </div>
          <div className={css.summe}>
            <span className={css.summeName}>{t("bestellungen")}</span>
            <span className={css.summeWert}>{zeilen.length}</span>
          </div>
        </div>

        {zeilen.length === 0 ? (
          <p className={css.leer}>{t("keine")}</p>
        ) : (
          <ul className={css.zeilen}>
            <li className={`${css.zeile} ${css.zeileKopf}`} aria-hidden="true">
              <span>{t("name")}</span>
              <span className={css.zahl}>{t("tickets")}</span>
            </li>
            {zeilen.map((z) => (
              <li key={z.id} className={css.zeile}>
                <span className={css.wer}>
                  <span className={z.name ? css.name : `${css.name} ${css.ohneName}`}>
                    {z.name || t("ohneName")}
                  </span>
                  <span className={css.art}>
                    {z.art}
                    {z.fastlane ? ` · ${t("fastlane")}` : ""}
                  </span>
                  {z.namen.length > 0 ? (
                    <span className={css.art}>{t("namen", { namen: z.namen.join(", ") })}</span>
                  ) : null}
                  {z.promoter ? (
                    <span className={css.promoter}>{t("promoter", { name: z.promoter })}</span>
                  ) : null}
                </span>
                <span className={css.zahl}>
                  <span className="nur-sr">{t("tickets")}: </span>
                  {z.tickets}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className={css.fussnote}>
          <p>{t("umfang")}</p>
          <p>{t("geheim")}</p>
        </div>
      </main>
    </div>
  );
}
