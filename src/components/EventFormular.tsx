"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { BildFeld } from "./BildFeld";
import { speichereEvent, type EventEingabe } from "@/app/aktionen/event-speichern";
import css from "./EventFormular.module.css";
import {
  LEERE_PHASE,
  type EventStand,
  type OrtWahl,
  type PhasenStand,
} from "@/lib/event-stand";

export type { EventStand, OrtWahl, PhasenStand };

const KATEGORIEN = ["club", "party", "festival", "rooftop", "special"];

/** "39,50" oder "39.50" → 3950 */
function centAus(text: string): number {
  const zahl = Number(text.replace(",", ".").trim());
  return Number.isFinite(zahl) ? Math.round(zahl * 100) : 0;
}

function slugAus(titel: string): string {
  return titel
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function EventFormular({
  start,
  orte,
}: {
  start: EventStand;
  orte: OrtWahl[];
}) {
  const router = useRouter();
  const [stand, setStand] = useState<EventStand>(start);
  const [neuerOrt, setNeuerOrt] = useState({ name: "", stadt: "", strasse: "", plz: "" });
  const [slugManuell, setSlugManuell] = useState(Boolean(start.id));
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  function setze<K extends keyof EventStand>(schluessel: K, wert: EventStand[K]) {
    setStand((alt) => ({ ...alt, [schluessel]: wert }));
  }

  function setzePhase(i: number, teil: Partial<PhasenStand>) {
    setStand((alt) => ({
      ...alt,
      phasen: alt.phasen.map((p, j) => (j === i ? { ...p, ...teil } : p)),
    }));
  }

  function speichern() {
    setFehler(null);
    setErfolg(null);

    const eingabe: EventEingabe = {
      id: stand.id,
      slug: stand.slug,
      titel: stand.titel,
      untertitel: stand.untertitel || null,
      teaser: stand.teaser || null,
      beschreibung: stand.beschreibung || null,
      kategorie: stand.kategorie,
      status: stand.status,
      beginn: stand.beginn,
      einlass: stand.einlass || null,
      ende: stand.ende || null,
      ort_id: stand.ortId || null,
      neuer_ort: stand.ortId ? null : neuerOrt,
      bild_pfad: stand.bildPfad || null,
      bild_alt: stand.bildAlt || null,
      bild_fokus: stand.bildFokus || null,
      mindestalter: stand.mindestalter ? Number(stand.mindestalter) : null,
      dresscode: stand.dresscode || null,
      abendkasse: stand.abendkasse,
      abendkasse_hinweis: stand.abendkasseHinweis || null,
      featured: stand.featured,
      fastlane_aktiv: stand.fastlaneAktiv,
      fastlane_preis_cent: centAus(stand.fastlanePreisEuro),
      fastlane_kontingent:
        stand.fastlaneKontingent.trim() === "" ? null : Number(stand.fastlaneKontingent),
      fastlane_beschreibung: stand.fastlaneBeschreibung || null,
      phasen: stand.phasen.map((p, i) => ({
        id: p.id,
        name: p.name,
        art: p.art,
        preis_cent: centAus(p.preisEuro),
        gebuehr_cent: centAus(p.gebuehrEuro),
        kontingent: p.kontingent.trim() === "" ? null : Number(p.kontingent),
        leistungen: p.leistungen,
        beschreibung: p.beschreibung || null,
        position: i + 1,
        aktiv: p.aktiv,
      })),
    };

    starte(async () => {
      const antwort = await speichereEvent(eingabe);
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      setErfolg("Gespeichert.");
      router.push(`/backoffice/events/${antwort.slug}`);
      router.refresh();
    });
  }

  return (
    <div className={css.form}>
      {/* ---------- Grunddaten ---------- */}
      <section className={css.gruppe}>
        <h2 className={css.gruppenTitel}>Grunddaten</h2>
        <div className={css.raster}>
          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.beschriftung} htmlFor="titel">
              Titel
            </label>
            <input
              id="titel"
              className={css.eingabe}
              value={stand.titel}
              onChange={(e) => {
                const titel = e.target.value;
                setStand((alt) => ({
                  ...alt,
                  titel,
                  slug: slugManuell ? alt.slug : slugAus(titel),
                }));
              }}
            />
          </div>

          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="slug">
              Adresse
            </label>
            <input
              id="slug"
              className={css.eingabe}
              value={stand.slug}
              onChange={(e) => {
                setSlugManuell(true);
                setze("slug", e.target.value);
              }}
            />
            <span className={css.hinweis}>lunar-events.de/events/{stand.slug || "…"}</span>
          </div>

          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="kategorie">
              Kategorie
            </label>
            <select
              id="kategorie"
              className={css.auswahl}
              value={stand.kategorie}
              onChange={(e) => setze("kategorie", e.target.value)}
            >
              {KATEGORIEN.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="untertitel">
              Untertitel
            </label>
            <input
              id="untertitel"
              className={css.eingabe}
              value={stand.untertitel}
              onChange={(e) => setze("untertitel", e.target.value)}
            />
          </div>

          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.beschriftung} htmlFor="teaser">
              Teaser
            </label>
            <input
              id="teaser"
              className={css.eingabe}
              value={stand.teaser}
              onChange={(e) => setze("teaser", e.target.value)}
            />
            <span className={css.hinweis}>
              Ein Satz. Steht auf der Karte und im geteilten Link.
            </span>
          </div>

          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.beschriftung} htmlFor="beschreibung">
              Beschreibung
            </label>
            <textarea
              id="beschreibung"
              className={css.textfeld}
              value={stand.beschreibung}
              onChange={(e) => setze("beschreibung", e.target.value)}
            />
            <span className={css.hinweis}>
              Leerzeile trennt Absätze.
            </span>
          </div>
        </div>
      </section>

      {/* ---------- Zeit und Ort ---------- */}
      <section className={css.gruppe}>
        <h2 className={css.gruppenTitel}>Wann und wo</h2>
        <div className={css.raster}>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="beginn">
              Beginn
            </label>
            <input
              id="beginn"
              type="datetime-local"
              className={css.eingabe}
              value={stand.beginn}
              onChange={(e) => setze("beginn", e.target.value)}
            />
          </div>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="einlass">
              Einlass
            </label>
            <input
              id="einlass"
              type="datetime-local"
              className={css.eingabe}
              value={stand.einlass}
              onChange={(e) => setze("einlass", e.target.value)}
            />
          </div>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="ende">
              Ende
            </label>
            <input
              id="ende"
              type="datetime-local"
              className={css.eingabe}
              value={stand.ende}
              onChange={(e) => setze("ende", e.target.value)}
            />
            <span className={css.hinweis}>Alle Zeiten in Ortszeit Berlin.</span>
          </div>

          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.beschriftung} htmlFor="ort">
              Ort
            </label>
            <select
              id="ort"
              className={css.auswahl}
              value={stand.ortId}
              onChange={(e) => setze("ortId", e.target.value)}
            >
              <option value="">Neuen Ort anlegen …</option>
              {orte.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}, {o.stadt}
                </option>
              ))}
            </select>
          </div>

          {stand.ortId === "" ? (
            <>
              <div className={css.feld}>
                <label className={css.beschriftung} htmlFor="ort-name">
                  Name der Location
                </label>
                <input
                  id="ort-name"
                  className={css.eingabe}
                  value={neuerOrt.name}
                  onChange={(e) => setNeuerOrt((o) => ({ ...o, name: e.target.value }))}
                />
              </div>
              <div className={css.feld}>
                <label className={css.beschriftung} htmlFor="ort-stadt">
                  Stadt
                </label>
                <input
                  id="ort-stadt"
                  className={css.eingabe}
                  value={neuerOrt.stadt}
                  onChange={(e) => setNeuerOrt((o) => ({ ...o, stadt: e.target.value }))}
                />
              </div>
              <div className={css.feld}>
                <label className={css.beschriftung} htmlFor="ort-strasse">
                  Straße
                </label>
                <input
                  id="ort-strasse"
                  className={css.eingabe}
                  value={neuerOrt.strasse}
                  onChange={(e) => setNeuerOrt((o) => ({ ...o, strasse: e.target.value }))}
                />
              </div>
              <div className={css.feld}>
                <label className={css.beschriftung} htmlFor="ort-plz">
                  PLZ
                </label>
                <input
                  id="ort-plz"
                  className={css.eingabe}
                  value={neuerOrt.plz}
                  onChange={(e) => setNeuerOrt((o) => ({ ...o, plz: e.target.value }))}
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* ---------- Bild ---------- */}
      <section className={css.gruppe}>
        <h2 className={css.gruppenTitel}>Bild</h2>
        <BildFeld
          pfad={stand.bildPfad}
          alt={stand.bildAlt}
          fokus={stand.bildFokus}
          aendern={({ pfad, alt, fokus }) =>
            setStand((v) => ({ ...v, bildPfad: pfad, bildAlt: alt, bildFokus: fokus }))
          }
        />
        <p className={css.hinweis}>
          Ohne Bild zeigt die Seite eine dunkle Verlaufsfläche. Das sieht
          ordentlich aus, verkauft aber nichts — laut Briefing trägt die
          Fotografie die halbe Gestaltung.
        </p>
      </section>

      {/* ---------- Einlassregeln ---------- */}
      <section className={css.gruppe}>
        <h2 className={css.gruppenTitel}>Einlass</h2>
        <div className={css.raster}>
          <div className={css.feld}>
            <label className={css.beschriftung} htmlFor="alter">
              Mindestalter
            </label>
            <input
              id="alter"
              type="number"
              min={0}
              max={99}
              className={css.eingabe}
              value={stand.mindestalter}
              onChange={(e) => setze("mindestalter", e.target.value)}
            />
          </div>
          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.beschriftung} htmlFor="dresscode">
              Dresscode
            </label>
            <input
              id="dresscode"
              className={css.eingabe}
              value={stand.dresscode}
              onChange={(e) => setze("dresscode", e.target.value)}
            />
          </div>
          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.schalter}>
              <input
                type="checkbox"
                checked={stand.abendkasse}
                onChange={(e) => setze("abendkasse", e.target.checked)}
              />
              Abendkasse anbieten
            </label>
            <span className={css.hinweis}>
              Das ist eine Zusage an den Gast — nur anhaken, wenn es sie
              wirklich gibt.
            </span>
          </div>
          {stand.abendkasse ? (
            <div className={`${css.feld} ${css.breit}`}>
              <label className={css.beschriftung} htmlFor="ak-hinweis">
                Hinweis zur Abendkasse
              </label>
              <input
                id="ak-hinweis"
                className={css.eingabe}
                placeholder="Preis kann abweichen"
                value={stand.abendkasseHinweis}
                onChange={(e) => setze("abendkasseHinweis", e.target.value)}
              />
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------- Fast Lane ---------- */}
      <section className={css.gruppe}>
        <h2 className={css.gruppenTitel}>Fast Lane</h2>
        <div className={css.raster}>
          <div className={`${css.feld} ${css.breit}`}>
            <label className={css.schalter}>
              <input
                type="checkbox"
                checked={stand.fastlaneAktiv}
                onChange={(e) => setze("fastlaneAktiv", e.target.checked)}
              />
              Fast Lane anbieten
            </label>
            <span className={css.hinweis}>
              Nach der Ticketwahl erscheint in der Kasse ein Fenster mit dem
              Upgrade. Am Einlass zeigt der Scanner „Fast Lane“ an — die
              eigene Spur muss es vor Ort dann auch geben.
            </span>
          </div>
          {stand.fastlaneAktiv ? (
            <>
              <div className={css.feld}>
                <label className={css.beschriftung} htmlFor="fl-preis">
                  Preis pro Ticket (€)
                </label>
                <input
                  id="fl-preis"
                  inputMode="decimal"
                  className={css.eingabe}
                  value={stand.fastlanePreisEuro}
                  onChange={(e) => setze("fastlanePreisEuro", e.target.value)}
                />
              </div>
              <div className={css.feld}>
                <label className={css.beschriftung} htmlFor="fl-kontingent">
                  Kontingent
                </label>
                <input
                  id="fl-kontingent"
                  type="number"
                  min={stand.fastlaneVerkauft}
                  className={css.eingabe}
                  placeholder="unbegrenzt"
                  value={stand.fastlaneKontingent}
                  onChange={(e) => setze("fastlaneKontingent", e.target.value)}
                />
                <span className={css.hinweis}>
                  {stand.fastlaneVerkauft > 0
                    ? `${stand.fastlaneVerkauft} schon verkauft (inkl. laufender Reservierungen).`
                    : "Leer lassen für unbegrenzt."}
                </span>
              </div>
              <div className={`${css.feld} ${css.breit}`}>
                <label className={css.beschriftung} htmlFor="fl-text">
                  Beschreibung im Fenster
                </label>
                <textarea
                  id="fl-text"
                  rows={2}
                  className={css.eingabe}
                  placeholder="Eigene Spur am Einlass: Du gehst an der Schlange vorbei und bist direkt drin."
                  value={stand.fastlaneBeschreibung}
                  onChange={(e) => setze("fastlaneBeschreibung", e.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* ---------- Phasen ---------- */}
      <section className={css.gruppe}>
        <h2 className={css.gruppenTitel}>Ticketphasen</h2>

        {stand.phasen.map((phase, i) => (
          <div key={phase.id ?? `neu-${i}`} className={css.phase}>
            <div className={css.phasenKopf}>
              <span className={css.phasenNummer}>{String(i + 1).padStart(2, "0")}</span>
              <input
                className={css.eingabe}
                style={{ flex: 1, minWidth: 160 }}
                placeholder="Early Bird"
                value={phase.name}
                onChange={(e) => setzePhase(i, { name: e.target.value })}
                aria-label={`Name der Phase ${i + 1}`}
              />
              <select
                className={css.auswahl}
                value={phase.art}
                onChange={(e) =>
                  setzePhase(i, { art: e.target.value as "standard" | "vip" })
                }
                aria-label={`Art der Phase ${i + 1}`}
              >
                <option value="standard">Verkauf</option>
                <option value="vip">VIP (auf Anfrage)</option>
              </select>
              {phase.verkauft > 0 ? (
                <span className={css.verkauftMarke}>{phase.verkauft} verkauft</span>
              ) : null}
              <button
                type="button"
                className={css.entfernen}
                disabled={phase.verkauft > 0}
                title={
                  phase.verkauft > 0
                    ? "Phase mit Verkäufen kann nicht entfernt werden — stattdessen stilllegen"
                    : undefined
                }
                onClick={() =>
                  setStand((alt) => ({
                    ...alt,
                    phasen: alt.phasen.filter((_, j) => j !== i),
                  }))
                }
              >
                Entfernen
              </button>
            </div>

            {phase.art === "standard" ? (
              <div className={css.raster}>
                <div className={css.feld}>
                  <label className={css.beschriftung}>Preis (€)</label>
                  <input
                    className={css.eingabe}
                    inputMode="decimal"
                    placeholder="29,00"
                    value={phase.preisEuro}
                    onChange={(e) => setzePhase(i, { preisEuro: e.target.value })}
                  />
                </div>
                <div className={css.feld}>
                  <label className={css.beschriftung}>Gebühr (€)</label>
                  <input
                    className={css.eingabe}
                    inputMode="decimal"
                    value={phase.gebuehrEuro}
                    onChange={(e) => setzePhase(i, { gebuehrEuro: e.target.value })}
                  />
                  <span className={css.hinweis}>Ist im angezeigten Preis enthalten.</span>
                </div>
                <div className={css.feld}>
                  <label className={css.beschriftung}>Kontingent</label>
                  <input
                    className={css.eingabe}
                    inputMode="numeric"
                    placeholder="leer = unbegrenzt"
                    value={phase.kontingent}
                    onChange={(e) => setzePhase(i, { kontingent: e.target.value })}
                  />
                </div>
              </div>
            ) : (
              <div className={css.feld}>
                <label className={css.beschriftung}>Beschreibung</label>
                <input
                  className={css.eingabe}
                  placeholder="Für vier bis zwölf Gäste."
                  value={phase.beschreibung}
                  onChange={(e) => setzePhase(i, { beschreibung: e.target.value })}
                />
              </div>
            )}

            <div className={css.feld}>
              <label className={css.beschriftung}>Enthalten</label>
              {phase.leistungen.map((l, k) => (
                <div key={k} className={css.leistungszeile}>
                  <input
                    className={css.eingabe}
                    style={{ flex: 1 }}
                    value={l}
                    onChange={(e) =>
                      setzePhase(i, {
                        leistungen: phase.leistungen.map((alt, j) =>
                          j === k ? e.target.value : alt,
                        ),
                      })
                    }
                    aria-label={`Leistung ${k + 1}`}
                  />
                  <button
                    type="button"
                    className={css.entfernen}
                    onClick={() =>
                      setzePhase(i, {
                        leistungen: phase.leistungen.filter((_, j) => j !== k),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={css.entfernen}
                style={{ alignSelf: "flex-start", paddingLeft: 0 }}
                onClick={() =>
                  setzePhase(i, { leistungen: [...phase.leistungen, ""] })
                }
              >
                + Zeile
              </button>
            </div>

            <label className={css.schalter}>
              <input
                type="checkbox"
                checked={phase.aktiv}
                onChange={(e) => setzePhase(i, { aktiv: e.target.checked })}
              />
              Aktiv (sichtbar und kaufbar)
            </label>
          </div>
        ))}

        <Knopf
          stil="linie"
          groesse="klein"
          onClick={() =>
            setStand((alt) => ({ ...alt, phasen: [...alt.phasen, { ...LEERE_PHASE }] }))
          }
        >
          Phase hinzufügen
        </Knopf>
      </section>

      {fehler ? <p className={css.stoerung}>{fehler}</p> : null}
      {erfolg ? <p className={css.erfolg}>{erfolg}</p> : null}

      <div className={css.fuss}>
        <div className={css.feld} style={{ minWidth: 180 }}>
          <label className={css.beschriftung} htmlFor="status">
            Status
          </label>
          <select
            id="status"
            className={css.auswahl}
            value={stand.status}
            onChange={(e) => setze("status", e.target.value)}
          >
            <option value="entwurf">Entwurf (nicht sichtbar)</option>
            <option value="veroeffentlicht">Veröffentlicht</option>
            <option value="abgesagt">Abgesagt</option>
            <option value="archiviert">Archiviert</option>
          </select>
        </div>

        <label className={css.schalter}>
          <input
            type="checkbox"
            checked={stand.featured}
            onChange={(e) => setze("featured", e.target.checked)}
          />
          Auf der Startseite hervorheben
        </label>

        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          {stand.id ? (
            <Knopf href={`/events/${stand.slug}`} stil="linie" groesse="klein">
              Ansehen
            </Knopf>
          ) : null}
          <Knopf onClick={speichern} disabled={laeuft}>
            {laeuft ? "…" : "Speichern"}
          </Knopf>
        </div>
      </div>
    </div>
  );
}
