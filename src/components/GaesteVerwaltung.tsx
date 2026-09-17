"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { entferneGast, speichereGast, verschickeGastTickets } from "@/app/aktionen/gaesteliste";
import { GAST_MAX_BEGLEITUNG, type Gast } from "@/lib/typen";
import formular from "./EventFormular.module.css";
import css from "@/app/[locale]/backoffice/backoffice.module.css";

type Stand = { id: string | null; name: string; email: string; begleitung: number; notiz: string };
const LEER: Stand = { id: null, name: "", email: "", begleitung: 0, notiz: "" };

/**
 * Die Gästeliste eines Events: oben das Formular (nur Admins), darunter die
 * Liste mit Einlass-Stand. Jede Person bekommt ein eigenes Ticket; der Link
 * dazu lässt sich kopieren (Messenger) oder per Mail schicken.
 */
export function GaesteVerwaltung({
  eventId,
  eventSlug,
  gaeste,
  darfAendern,
  versand,
  adresse,
}: {
  eventId: string;
  eventSlug: string;
  gaeste: Gast[];
  darfAendern: boolean;
  /** Mailversand eingerichtet */
  versand: boolean;
  /** Basis für die Ticketlinks, z. B. https://lunar-events.de */
  adresse: string;
}) {
  const router = useRouter();
  const [stand, setStand] = useState<Stand>(LEER);
  const [mailSenden, setMailSenden] = useState(true);
  const [suche, setSuche] = useState("");
  const [meldung, setMeldung] = useState<{ art: "gut" | "schlecht"; text: string } | null>(null);
  const [kopiert, setKopiert] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  const summe = useMemo(
    () => ({
      personen: gaeste.reduce((s, g) => s + g.personen, 0),
      drin: gaeste.reduce((s, g) => s + g.drin, 0),
    }),
    [gaeste],
  );
  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase();
    if (!s) return gaeste;
    return gaeste.filter(
      (g) =>
        g.name.toLowerCase().includes(s) ||
        (g.email ?? "").includes(s) ||
        (g.notiz ?? "").toLowerCase().includes(s),
    );
  }, [gaeste, suche]);

  function setze<K extends keyof Stand>(schluessel: K, wert: Stand[K]) {
    setStand((alt) => ({ ...alt, [schluessel]: wert }));
    setMeldung(null);
  }

  function speichern() {
    setMeldung(null);
    starte(async () => {
      const antwort = await speichereGast({
        ...stand,
        eventId,
        eventSlug,
        mailSenden: versand && mailSenden && Boolean(stand.email.trim()),
      });
      if (!antwort.ok) {
        setMeldung({ art: "schlecht", text: antwort.fehler });
        return;
      }
      const teile = [stand.id ? `${stand.name} gespeichert.` : `${stand.name} steht auf der Liste.`];
      if (antwort.mail === "verschickt") teile.push("QR-Codes per Mail verschickt.");
      if (antwort.mail === "fehlgeschlagen") {
        teile.push("Die Mail ist nicht rausgegangen — Link kopieren und selbst schicken.");
      }
      setMeldung({ art: antwort.mail === "fehlgeschlagen" ? "schlecht" : "gut", text: teile.join(" ") });
      setStand(LEER);
      setMailSenden(true);
      router.refresh();
    });
  }

  function bearbeiten(g: Gast) {
    setStand({
      id: g.id,
      name: g.name,
      email: g.email ?? "",
      begleitung: g.begleitung,
      notiz: g.notiz ?? "",
    });
    setMailSenden(false);
    setMeldung(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function entfernen(g: Gast) {
    const sicher = window.confirm(
      `${g.name} von der Gästeliste nehmen? Die QR-Codes gelten dann nicht mehr` +
        (g.drin > 0 ? ` (${g.drin} schon drin — das bleibt so).` : "."),
    );
    if (!sicher) return;
    starte(async () => {
      const antwort = await entferneGast(g.id, eventSlug);
      setMeldung(
        antwort.ok
          ? { art: "gut", text: `${g.name} ist von der Liste.` }
          : { art: "schlecht", text: antwort.fehler ?? "Entfernen fehlgeschlagen." },
      );
      router.refresh();
    });
  }

  function mailSchicken(g: Gast) {
    starte(async () => {
      const antwort = await verschickeGastTickets(g.id);
      setMeldung(
        antwort.ok
          ? { art: "gut", text: `Mail an ${g.email} ist raus.` }
          : { art: "schlecht", text: antwort.fehler ?? "Versand fehlgeschlagen." },
      );
      router.refresh();
    });
  }

  async function linkKopieren(g: Gast) {
    try {
      await navigator.clipboard.writeText(`${adresse}/tickets/${g.token}`);
      setKopiert(g.id);
      setTimeout(() => setKopiert(null), 2000);
    } catch {
      window.prompt("Link zum Kopieren:", `${adresse}/tickets/${g.token}`);
    }
  }

  const datum = (iso: string) =>
    new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));

  return (
    <div className={formular.form}>
      {darfAendern ? (
        <section className={formular.gruppe}>
          <h2 className={formular.gruppenTitel}>
            {stand.id ? `${stand.name || "Eintrag"} bearbeiten` : "Gast hinzufügen"}
          </h2>
          <fieldset className={formular.sperre} disabled={laeuft}>
            <div className={formular.raster}>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="gast-name">
                  Name
                </label>
                <input
                  id="gast-name"
                  className={formular.eingabe}
                  value={stand.name}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => setze("name", e.target.value)}
                />
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="gast-begleitung">
                  Begleitung
                </label>
                <select
                  id="gast-begleitung"
                  className={formular.auswahl}
                  value={stand.begleitung}
                  onChange={(e) => setze("begleitung", Number(e.target.value))}
                >
                  {Array.from({ length: GAST_MAX_BEGLEITUNG + 1 }, (_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? "keine" : `+${i}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="gast-email">
                  E-Mail (freiwillig)
                </label>
                <input
                  id="gast-email"
                  type="email"
                  className={formular.eingabe}
                  value={stand.email}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setze("email", e.target.value)}
                />
              </div>
              <div className={formular.feld}>
                <label className={formular.beschriftung} htmlFor="gast-notiz">
                  Notiz (sieht auch der Einlass)
                </label>
                <input
                  id="gast-notiz"
                  className={formular.eingabe}
                  value={stand.notiz}
                  placeholder="z. B. DJ, Presse, Freund von Niklas"
                  onChange={(e) => setze("notiz", e.target.value)}
                />
              </div>
            </div>
            {versand ? (
              <label className={formular.schalter}>
                <input
                  type="checkbox"
                  checked={mailSenden && Boolean(stand.email.trim())}
                  disabled={!stand.email.trim()}
                  onChange={(e) => setMailSenden(e.target.checked)}
                />
                QR-Codes nach dem Speichern per Mail schicken
              </label>
            ) : (
              <span className={formular.hinweis}>
                Kein Mailversand eingerichtet — den Link in der Liste kopieren und selbst schicken.
              </span>
            )}
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Knopf onClick={speichern} disabled={laeuft || !stand.name.trim()}>
                {laeuft ? "…" : stand.id ? "Speichern" : "Auf die Gästeliste"}
              </Knopf>
              {stand.id ? (
                <Knopf stil="linie" onClick={() => {
                    setStand(LEER);
                    setMailSenden(true);
                  }}>
                  Abbrechen
                </Knopf>
              ) : null}
            </div>
          </fieldset>
        </section>
      ) : (
        <p className={formular.stoerung}>
          Du kannst die Gästeliste ansehen, aber nicht ändern — das dürfen nur Admins.
        </p>
      )}

      {meldung ? (
        <p className={meldung.art === "gut" ? formular.erfolg : formular.stoerung} role="status">
          {meldung.text}
        </p>
      ) : null}

      <section className={formular.gruppe}>
        <h2 className={formular.gruppenTitel}>
          {gaeste.length} {gaeste.length === 1 ? "Eintrag" : "Einträge"} · {summe.personen}{" "}
          {summe.personen === 1 ? "Person" : "Personen"} · {summe.drin} drin
        </h2>
        <span className={formular.hinweis}>
          Jede Person hat einen eigenen QR-Code. Am Einlass geht es auch ohne: Unter
          „Gästeliste“ im Scanner stehen alle Namen, abgehakt wird dasselbe Ticket. Die
          Gästeliste zählt nicht zum Verkauf und nimmt keinem Kontingent etwas weg.
        </span>
        {gaeste.length > 8 ? (
          <input
            className={formular.eingabe}
            placeholder="Suchen …"
            aria-label="Gästeliste durchsuchen"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
        ) : null}
        <div className={css.tabellenfeld}>
          <table className={css.tabelle}>
            <thead>
              <tr>
                <th>Gast</th>
                <th className={css.zahl}>Personen</th>
                <th className={css.zahl}>Drin</th>
                <th>Mail</th>
                <th>Link</th>
                {darfAendern ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sichtbar.length === 0 ? (
                <tr>
                  <td colSpan={darfAendern ? 6 : 5} className={css.leer}>
                    {gaeste.length === 0 ? "Noch niemand auf der Gästeliste." : "Kein Treffer."}
                  </td>
                </tr>
              ) : (
                sichtbar.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className={css.haupt}>{g.name}</div>
                      {g.notiz ? <div className={css.nebensache}>{g.notiz}</div> : null}
                    </td>
                    <td className={css.zahl}>
                      {g.begleitung > 0 ? `1 + ${g.begleitung}` : "1"}
                    </td>
                    <td className={css.zahl}>
                      <span
                        className={`${css.marke_} ${
                          g.drin === 0 ? css.neutral : g.drin >= g.personen ? css.gut : css.warte
                        }`}
                      >
                        {g.drin} / {g.personen}
                      </span>
                    </td>
                    <td>
                      {g.email ? (
                        <>
                          <div className={css.nebensache}>{g.email}</div>
                          <div className={css.nebensache}>
                            {g.mail_gesendet_am ? `gesendet ${datum(g.mail_gesendet_am)}` : "nicht gesendet"}
                          </div>
                          {darfAendern && versand ? (
                            <button
                              type="button"
                              className={css.textknopf}
                              disabled={laeuft}
                              onClick={() => mailSchicken(g)}
                            >
                              {g.mail_gesendet_am ? "Nochmal schicken" : "Schicken"}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className={css.nebensache}>—</span>
                      )}
                    </td>
                    <td>
                      <Knopf stil="linie" groesse="klein" onClick={() => linkKopieren(g)}>
                        <span aria-live="polite">{kopiert === g.id ? "Kopiert" : "Kopieren"}</span>
                      </Knopf>
                    </td>
                    {darfAendern ? (
                      <td>
                        <div style={{ display: "flex", gap: "var(--space-2)" }}>
                          <button
                            type="button"
                            className={css.textknopf}
                            disabled={laeuft}
                            onClick={() => bearbeiten(g)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            type="button"
                            className={formular.entfernen}
                            disabled={laeuft}
                            onClick={() => entfernen(g)}
                          >
                            Entfernen
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
