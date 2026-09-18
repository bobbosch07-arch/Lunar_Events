"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { KopierFeld } from "./KopierFeld";
import { speichereVip, storniereVip, verschickeVipTickets } from "@/app/aktionen/vip-buchung";
import formular from "./EventFormular.module.css";

type GastZeile = {
  /** null = neu, noch ohne Ticket */
  id: string | null;
  name: string;
  /** Eigener Link des Gastes, sobald ausgestellt. */
  link: string | null;
  /** Schon eingelassen — dann nicht mehr entfernbar. */
  drin: boolean;
};

export type VipBuchungStand = {
  eventId: string;
  tisch: string;
  betragEuro: string;
  bezahlt: boolean;
  gaeste: GastZeile[];
};

/** "600" oder "599,50" → Cent; leer → null (nichts vereinbart). */
function centAus(text: string): number | null {
  if (!text.trim()) return null;
  const zahl = Number(text.replace(",", ".").trim());
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : null;
}

/**
 * VIP-Tickets ausstellen (0028): Event, Tisch, Betrag und die Namen — ein
 * Ticket je Name. Gespeichert wird immer die ganze Liste; was fehlt, wird
 * storniert. Bezahlt wird außerhalb des Systems, der Betrag steht hier nur
 * zur Übersicht.
 */
export function VipBuchung({
  anfrageId,
  anfrageEmail,
  events,
  start,
  gastgeberLink,
  versand,
  gesendetAm,
}: {
  anfrageId: string;
  anfrageEmail: string;
  events: Array<{ id: string; titel: string; wann: string }>;
  start: VipBuchungStand;
  /** Alle Tickets auf einer Seite, sobald ausgestellt. */
  gastgeberLink: string | null;
  versand: boolean;
  /** Schon formatiert — eine Funktion ließe sich nicht herüberreichen. */
  gesendetAm: string | null;
}) {
  const router = useRouter();
  const [stand, setStand] = useState(start);
  const [laeuft, starte] = useTransition();
  const [meldung, setMeldung] = useState<{ art: "gut" | "schlecht"; text: string } | null>(null);
  const ausgestellt = Boolean(gastgeberLink);

  function setzeGast(i: number, name: string) {
    setStand((s) => ({ ...s, gaeste: s.gaeste.map((g, j) => (j === i ? { ...g, name } : g)) }));
  }

  function speichern() {
    setMeldung(null);
    const betragCent = centAus(stand.betragEuro);
    if (stand.betragEuro.trim() && betragCent === null) {
      setMeldung({ art: "schlecht", text: "Der Betrag ist keine Zahl." });
      return;
    }
    const gaeste = stand.gaeste.filter((g) => g.id || g.name.trim());
    if (gaeste.some((g) => !g.name.trim())) {
      setMeldung({ art: "schlecht", text: "Jeder Gast braucht einen Namen — oder die Zeile entfernen." });
      return;
    }
    starte(async () => {
      const ergebnis = await speichereVip({
        anfrageId,
        eventId: stand.eventId,
        tisch: stand.tisch,
        betragCent,
        bezahlt: stand.bezahlt,
        gaeste: gaeste.map((g) => ({ id: g.id, name: g.name })),
      });
      if (!ergebnis.ok) {
        setMeldung({ art: "schlecht", text: ergebnis.fehler });
        return;
      }
      setMeldung({
        art: "gut",
        text: `${ergebnis.gaeste.length} ${ergebnis.gaeste.length === 1 ? "Ticket" : "Tickets"} ausgestellt.`,
      });
      router.refresh();
    });
  }

  function verschicken() {
    setMeldung(null);
    starte(async () => {
      const ergebnis = await verschickeVipTickets(anfrageId);
      setMeldung(
        ergebnis.ok
          ? { art: "gut", text: `Link an ${anfrageEmail} verschickt.` }
          : { art: "schlecht", text: ergebnis.fehler ?? "Versand fehlgeschlagen." },
      );
      if (ergebnis.ok) router.refresh();
    });
  }

  function stornieren() {
    if (!window.confirm("Alle VIP-Tickets dieser Buchung stornieren? Wer schon drin ist, bleibt drin.")) {
      return;
    }
    setMeldung(null);
    starte(async () => {
      const ergebnis = await storniereVip(anfrageId);
      setMeldung(
        ergebnis.ok
          ? { art: "gut", text: "Alle offenen Tickets storniert." }
          : { art: "schlecht", text: ergebnis.fehler ?? "Stornieren fehlgeschlagen." },
      );
      if (ergebnis.ok) router.refresh();
    });
  }

  return (
    <div className={formular.form}>
      <section className={formular.gruppe}>
        <h2 className={formular.gruppenTitel}>{ausgestellt ? "Buchung" : "Tickets ausstellen"}</h2>
        <fieldset className={formular.sperre} disabled={laeuft}>
          <div className={formular.raster}>
            <div className={`${formular.feld} ${formular.breit}`}>
              <label className={formular.beschriftung} htmlFor="vip-event">
                Event
              </label>
              <select
                id="vip-event"
                className={formular.auswahl}
                value={stand.eventId}
                onChange={(e) => setStand((s) => ({ ...s, eventId: e.target.value }))}
              >
                <option value="">Event wählen …</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.titel} · {e.wann}
                  </option>
                ))}
              </select>
              {ausgestellt ? (
                <span className={formular.hinweis}>
                  Das Event bleibt, solange Tickets ausgestellt sind.
                </span>
              ) : null}
            </div>
            <div className={formular.feld}>
              <label className={formular.beschriftung} htmlFor="vip-tisch">
                Tisch
              </label>
              <input
                id="vip-tisch"
                className={formular.eingabe}
                value={stand.tisch}
                maxLength={40}
                placeholder="z. B. Tisch 4 oder Lounge links"
                onChange={(e) => setStand((s) => ({ ...s, tisch: e.target.value }))}
              />
              <span className={formular.hinweis}>Steht genau so auf jedem Ticket und im Scanner.</span>
            </div>
            <div className={formular.feld}>
              <label className={formular.beschriftung} htmlFor="vip-betrag">
                Vereinbarter Betrag (€)
              </label>
              <input
                id="vip-betrag"
                className={formular.eingabe}
                inputMode="decimal"
                value={stand.betragEuro}
                placeholder="freiwillig"
                onChange={(e) => setStand((s) => ({ ...s, betragEuro: e.target.value }))}
              />
              <label className={formular.schalter}>
                <input
                  type="checkbox"
                  checked={stand.bezahlt}
                  onChange={(e) => setStand((s) => ({ ...s, bezahlt: e.target.checked }))}
                />
                Bezahlt
              </label>
              <span className={formular.hinweis}>
                Nur zur Übersicht — bezahlt wird außerhalb (Tisch, Überweisung).
              </span>
            </div>
          </div>
        </fieldset>
      </section>

      <section className={formular.gruppe}>
        <h2 className={formular.gruppenTitel}>
          Gäste ({stand.gaeste.filter((g) => g.id || g.name.trim()).length})
        </h2>
        <fieldset className={formular.sperre} disabled={laeuft}>
          {stand.gaeste.map((g, i) => (
            <div key={g.id ?? `neu-${i}`} className={formular.feld}>
              <div className={formular.leistungszeile}>
                <input
                  className={formular.eingabe}
                  style={{ flex: 1 }}
                  value={g.name}
                  maxLength={120}
                  autoComplete="off"
                  placeholder={i === 0 ? "Vor- und Nachname" : "Name"}
                  aria-label={`Gast ${i + 1}`}
                  onChange={(e) => setzeGast(i, e.target.value)}
                />
                <button
                  type="button"
                  className={formular.entfernen}
                  disabled={g.drin}
                  title={g.drin ? "Schon eingelassen — bleibt stehen" : undefined}
                  onClick={() =>
                    setStand((s) => ({ ...s, gaeste: s.gaeste.filter((_, j) => j !== i) }))
                  }
                >
                  {g.drin ? "Drin" : "Entfernen"}
                </button>
              </div>
              {g.link ? (
                <KopierFeld
                  wert={g.link}
                  beschriftung="Link kopieren"
                  kopiert="Kopiert"
                  klasse={formular.leistungszeile}
                  wertKlasse={formular.linkwert}
                />
              ) : null}
            </div>
          ))}
          <div>
            <Knopf
              stil="linie"
              groesse="klein"
              disabled={stand.gaeste.length >= 30}
              onClick={() =>
                setStand((s) => ({
                  ...s,
                  gaeste: [...s.gaeste, { id: null, name: "", link: null, drin: false }],
                }))
              }
            >
              Gast hinzufügen
            </Knopf>
          </div>
        </fieldset>
      </section>

      {meldung ? (
        <p className={meldung.art === "gut" ? formular.erfolg : formular.stoerung} role="status">
          {meldung.text}
        </p>
      ) : null}

      <div className={formular.fuss}>
        <Knopf onClick={speichern} disabled={laeuft || !stand.eventId}>
          {laeuft ? "…" : ausgestellt ? "Änderungen speichern" : "Tickets ausstellen"}
        </Knopf>
        {ausgestellt && versand ? (
          <Knopf stil="linie" onClick={verschicken} disabled={laeuft}>
            {gesendetAm ? "Nochmal per Mail schicken" : `Per Mail an ${anfrageEmail}`}
          </Knopf>
        ) : null}
        {ausgestellt ? (
          <Knopf stil="linie" onClick={stornieren} disabled={laeuft}>
            Alle stornieren
          </Knopf>
        ) : null}
      </div>

      {gastgeberLink ? (
        <section className={formular.gruppe}>
          <h2 className={formular.gruppenTitel}>Alle Tickets auf einer Seite</h2>
          <KopierFeld
            wert={gastgeberLink}
            beschriftung="Link kopieren"
            kopiert="Kopiert"
            klasse={formular.leistungszeile}
            wertKlasse={formular.linkwert}
          />
          <span className={formular.hinweis}>
            {gesendetAm
              ? `Per Mail verschickt: ${gesendetAm}.`
              : versand
                ? "Noch nicht verschickt."
                : "Kein Mailversand eingerichtet — den Link selbst schicken, z. B. per WhatsApp."}{" "}
            Unter jedem Namen oben steht außerdem ein Link nur für diese Person.
          </span>
        </section>
      ) : null}
    </div>
  );
}
