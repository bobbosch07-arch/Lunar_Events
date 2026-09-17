"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { loescheRabattcode, speichereRabattcode } from "@/app/aktionen/rabattcodes";
import { normalisiereCode, type RabattcodeStand } from "@/lib/rabatt";
import type { EventWahl } from "@/lib/backoffice";
import css from "./EventFormular.module.css";

/** Ohne 0/O und 1/I — Codes werden auch abgetippt oder vorgelesen. */
const ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function zufallsCode(): string {
  const werte = crypto.getRandomValues(new Uint32Array(8));
  return Array.from(werte, (w) => ZEICHEN[w % ZEICHEN.length]).join("");
}

/** "5,50" oder "5.50" → 550 */
function centAus(text: string): number {
  const zahl = Number(text.replace(",", ".").trim());
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : NaN;
}

export function RabattcodeFormular({
  start,
  events,
  darfAendern,
  eingeloest,
  adresse,
  promoter,
}: {
  start: RabattcodeStand;
  events: EventWahl[];
  /** Für die Auswahl "gehört zu Promoter" */
  promoter: Array<{ id: string; name: string }>;
  darfAendern: boolean;
  /** Schon eingelöste Tickets, für den Hinweis bei der Obergrenze */
  eingeloest: number;
  /** Öffentliche Adresse der Seite, für den Link zum Teilen */
  adresse: string;
}) {
  const router = useRouter();
  const [stand, setStand] = useState(start);
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const [laeuft, starte] = useTransition();

  function setze<K extends keyof RabattcodeStand>(schluessel: K, wert: RabattcodeStand[K]) {
    setStand((alt) => ({ ...alt, [schluessel]: wert }));
    setErfolg(null);
  }

  const event = events.find((e) => e.id === stand.eventId) ?? null;
  const codeText = normalisiereCode(stand.code);
  const teilLink = codeText
    ? `${adresse}${event ? `/events/${event.slug}` : ""}?code=${encodeURIComponent(codeText)}`
    : null;

  function speichern() {
    setFehler(null);
    setErfolg(null);

    const wert =
      stand.art === "prozent" ? Number(stand.wertText.trim()) : centAus(stand.wertText);
    if (!Number.isFinite(wert)) {
      setFehler("Der Rabatt ist keine Zahl.");
      return;
    }

    starte(async () => {
      const antwort = await speichereRabattcode({
        id: stand.id,
        code: stand.code,
        art: stand.art,
        wert,
        event_id: stand.eventId || null,
        // Nur Phasen, die zum gewählten Event gehören — nach einem
        // Eventwechsel hingen sonst fremde IDs daran.
        phasen_ids: event ? stand.phasenIds.filter((id) => event.phasen.some((p) => p.id === id)) : [],
        gueltig_ab: stand.gueltigAb || null,
        gueltig_bis: stand.gueltigBis || null,
        max_tickets: stand.maxTickets.trim() === "" ? null : Number(stand.maxTickets),
        einmal_pro_person: stand.einmalProPerson,
        aktiv: stand.aktiv,
        notiz: stand.notiz || null,
        promoter_id: stand.promoterId || null,
      });

      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      setErfolg("Gespeichert.");
      if (!stand.id) router.push(`/backoffice/rabattcodes/${antwort.id}`);
      router.refresh();
    });
  }

  function loeschen() {
    if (!stand.id) return;
    const sicher = window.confirm(
      `„${codeText}“ wirklich löschen? Wer ihn danach eingibt, bekommt keinen Rabatt mehr. ` +
        `Bestellungen, die ihn schon benutzt haben, behalten ihren Rabatt.\n\n` +
        `Nur vorübergehend abschalten? Dann „Aktiv“ herausnehmen.`,
    );
    if (!sicher) return;

    starte(async () => {
      const antwort = await loescheRabattcode(stand.id!);
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      router.push("/backoffice/rabattcodes");
      router.refresh();
    });
  }

  return (
    <div className={css.form}>
      {!darfAendern ? (
        <p className={css.stoerung}>
          Du kannst diesen Code ansehen, aber nicht ändern — das dürfen nur Admins.
        </p>
      ) : null}

      <fieldset className={css.sperre} disabled={!darfAendern || laeuft}>
        {/* ---------- Code ---------- */}
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Code</h2>
          <div className={css.raster}>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="code">
                Code
              </label>
              <div className={css.leistungszeile}>
                <input
                  id="code"
                  className={css.eingabe}
                  style={{ flex: 1, textTransform: "uppercase", letterSpacing: "0.06em" }}
                  value={stand.code}
                  onChange={(e) => setze("code", e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                />
                <Knopf stil="linie" groesse="klein" onClick={() => setze("code", zufallsCode())}>
                  Zufällig
                </Knopf>
              </div>
              <span className={css.hinweis}>
                Groß- und Kleinschreibung ist egal. Kurze Wörter wie „VIP“ lassen
                sich erraten — für Rabatte, die nicht jeder haben soll, lieber
                „Zufällig“.
              </span>
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="notiz">
                Notiz (nur intern)
              </label>
              <input
                id="notiz"
                className={css.eingabe}
                value={stand.notiz}
                placeholder="z. B. Insta-Story 20.09."
                onChange={(e) => setze("notiz", e.target.value)}
              />
            </div>
          </div>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="promoter">
              Gehört zu Promoter
            </label>
            <select
              id="promoter"
              className={css.auswahl}
              value={stand.promoterId}
              onChange={(e) => setze("promoterId", e.target.value)}
            >
              <option value="">Keinem</option>
              {promoter.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className={css.hinweis}>
              Käufe mit diesem Code zählen dann für den Promoter — auch wenn der
              Gast über einen anderen Link kam.
            </span>
          </div>
          <label className={css.schalter}>
            <input
              type="checkbox"
              checked={stand.aktiv}
              onChange={(e) => setze("aktiv", e.target.checked)}
            />
            Aktiv — ausgeschaltet verhält sich der Code wie ein unbekannter
          </label>
        </section>

        {/* ---------- Rabatt ---------- */}
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Rabatt</h2>
          <div className={css.raster}>
            <div className={css.feld}>
              <span className={css.beschriftung}>Art</span>
              <label className={css.schalter}>
                <input
                  type="radio"
                  name="art"
                  checked={stand.art === "prozent"}
                  onChange={() => setze("art", "prozent")}
                />
                Prozent vom Ticketpreis
              </label>
              <label className={css.schalter}>
                <input
                  type="radio"
                  name="art"
                  checked={stand.art === "betrag"}
                  onChange={() => setze("art", "betrag")}
                />
                Fester Betrag je Ticket
              </label>
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="wert">
                {stand.art === "prozent" ? "Rabatt in %" : "Rabatt in € je Ticket"}
              </label>
              <input
                id="wert"
                className={css.eingabe}
                inputMode={stand.art === "prozent" ? "numeric" : "decimal"}
                placeholder={stand.art === "prozent" ? "20" : "5,00"}
                value={stand.wertText}
                onChange={(e) => setze("wertText", e.target.value)}
              />
            </div>
          </div>
          <span className={css.hinweis}>
            Wirkt nur auf den Ticketpreis. Servicegebühr und Fast Lane zahlt der
            Gast voll. Ein Betrag über dem Ticketpreis macht das Ticket kostenlos,
            nie negativ.
          </span>
        </section>

        {/* ---------- Grenzen ---------- */}
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Grenzen — alle freiwillig</h2>
          <div className={css.raster}>
            <div className={`${css.feld} ${css.breit}`}>
              <label className={css.beschriftung} htmlFor="event">
                Gilt für
              </label>
              <select
                id="event"
                className={css.auswahl}
                value={stand.eventId}
                onChange={(e) => {
                  setze("eventId", e.target.value);
                  setze("phasenIds", []);
                }}
              >
                <option value="">Alle Events</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.titel} ·{" "}
                    {new Intl.DateTimeFormat("de", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      timeZone: "Europe/Berlin",
                    }).format(new Date(e.beginn))}
                  </option>
                ))}
                {stand.eventId && !event ? (
                  <option value={stand.eventId}>(Event nicht mehr in der Liste)</option>
                ) : null}
              </select>
            </div>

            {event && event.phasen.length > 0 ? (
              <div className={`${css.feld} ${css.breit}`}>
                <span className={css.beschriftung}>Nur diese Phasen</span>
                {event.phasen.map((p) => (
                  <label key={p.id} className={css.schalter}>
                    <input
                      type="checkbox"
                      checked={stand.phasenIds.includes(p.id)}
                      onChange={(e) =>
                        setze(
                          "phasenIds",
                          e.target.checked
                            ? [...stand.phasenIds, p.id]
                            : stand.phasenIds.filter((id) => id !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
                <span className={css.hinweis}>Nichts angehakt = alle Phasen.</span>
              </div>
            ) : null}

            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="ab">
                Gültig ab
              </label>
              <input
                id="ab"
                type="datetime-local"
                className={css.eingabe}
                value={stand.gueltigAb}
                onChange={(e) => setze("gueltigAb", e.target.value)}
              />
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="bis">
                Gültig bis
              </label>
              <input
                id="bis"
                type="datetime-local"
                className={css.eingabe}
                value={stand.gueltigBis}
                onChange={(e) => setze("gueltigBis", e.target.value)}
              />
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="max">
                Höchstens so viele Tickets
              </label>
              <input
                id="max"
                className={css.eingabe}
                inputMode="numeric"
                placeholder="unbegrenzt"
                value={stand.maxTickets}
                onChange={(e) => setze("maxTickets", e.target.value)}
              />
              <span className={css.hinweis}>
                Gezählt werden rabattierte Tickets, nicht Bestellungen.
                {stand.id ? ` Schon eingelöst: ${eingeloest} (laufende Reservierungen zählen mit).` : ""}
              </span>
            </div>
          </div>
          <label className={css.schalter}>
            <input
              type="checkbox"
              checked={stand.einmalProPerson}
              onChange={(e) => setze("einmalProPerson", e.target.checked)}
            />
            Einmal je Person
          </label>
          <span className={css.hinweis}>
            „Person“ heißt E-Mail-Adresse. Wer eine zweite Adresse benutzt, kommt
            trotzdem durch — gegen Absprache unter Freunden hilft das nicht, gegen
            versehentliches Mehrfach-Einlösen schon.
          </span>
        </section>
      </fieldset>

      {teilLink ? (
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Link zum Teilen</h2>
          <div className={css.leistungszeile}>
            <code className={css.eingabe} style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
              {teilLink}
            </code>
            <Knopf
              stil="linie"
              groesse="klein"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(teilLink);
                  setKopiert(true);
                  setTimeout(() => setKopiert(false), 2000);
                } catch {
                  // Ohne Zugriff auf die Zwischenablage bleibt der Link zum Markieren stehen.
                }
              }}
            >
              {kopiert ? "Kopiert" : "Kopieren"}
            </Knopf>
          </div>
          <span className={css.hinweis}>
            Wer über diesen Link kommt, hat den Code in der Kasse schon eingetragen —
            auch wenn er sich vorher noch umsieht.
            {stand.id ? "" : " Der Link funktioniert erst nach dem Speichern."}
          </span>
        </section>
      ) : null}

      {darfAendern ? (
        <div className={css.fuss}>
          <Knopf onClick={speichern} disabled={laeuft}>
            {laeuft ? "…" : stand.id ? "Speichern" : "Code anlegen"}
          </Knopf>
          {stand.id ? (
            <button type="button" className={css.entfernen} onClick={loeschen} disabled={laeuft}>
              Löschen
            </button>
          ) : null}
          {fehler ? <p className={css.stoerung}>{fehler}</p> : null}
          {erfolg ? <p className={css.erfolg}>{erfolg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
