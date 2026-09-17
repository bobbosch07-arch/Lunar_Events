"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import { KopierFeld } from "./KopierFeld";
import {
  erneuerePromoterLink,
  loeschePromoter,
  speicherePromoter,
} from "@/app/aktionen/promoter";
import { kuerzelAus, type PromoterStand } from "@/lib/promoter";
import css from "./EventFormular.module.css";

export type TeilLink = {
  titel: string;
  datum: string;
  link: string;
  /** Der Code, der im Link steckt, falls der Promoter einen fürs Event hat */
  code: string | null;
};

export function PromoterFormular({
  start,
  darfAendern,
  statistikLink,
  links,
}: {
  start: PromoterStand;
  darfAendern: boolean;
  /** Nur beim Bearbeiten — ein neuer Promoter hat noch keinen */
  statistikLink: string | null;
  links: TeilLink[];
}) {
  const router = useRouter();
  const [stand, setStand] = useState(start);
  const [kuerzelManuell, setKuerzelManuell] = useState(Boolean(start.id));
  const [fehler, setFehler] = useState<string | null>(null);
  const [erfolg, setErfolg] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();

  function setze<K extends keyof PromoterStand>(schluessel: K, wert: PromoterStand[K]) {
    setStand((alt) => ({ ...alt, [schluessel]: wert }));
    setErfolg(null);
  }

  function speichern() {
    setFehler(null);
    setErfolg(null);
    starte(async () => {
      const antwort = await speicherePromoter({
        id: stand.id,
        name: stand.name,
        kuerzel: stand.kuerzel,
        aktiv: stand.aktiv,
        notiz: stand.notiz || null,
      });
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      setErfolg("Gespeichert.");
      if (!stand.id) router.push(`/backoffice/promoter/${antwort.id}`);
      router.refresh();
    });
  }

  function neuerLink() {
    if (!stand.id) return;
    const sicher = window.confirm(
      `Neuen Statistik-Link für ${stand.name} erzeugen? Der bisherige funktioniert ` +
        `danach nicht mehr — schick ${stand.name} den neuen.`,
    );
    if (!sicher) return;
    starte(async () => {
      const antwort = await erneuerePromoterLink(stand.id!);
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      setErfolg("Neuer Link erzeugt.");
      router.refresh();
    });
  }

  function loeschen() {
    if (!stand.id) return;
    const sicher = window.confirm(
      `${stand.name} wirklich löschen? Die Zahlen und der Statistik-Link sind dann weg. ` +
        `Codes bleiben bestehen und gehören danach niemandem.\n\n` +
        `Nur vorübergehend nicht mehr zählen? Dann „Aktiv“ herausnehmen.`,
    );
    if (!sicher) return;
    starte(async () => {
      const antwort = await loeschePromoter(stand.id!);
      if (!antwort.ok) {
        setFehler(antwort.fehler);
        return;
      }
      router.push("/backoffice/promoter");
      router.refresh();
    });
  }

  return (
    <div className={css.form}>
      {!darfAendern ? (
        <p className={css.stoerung}>
          Du kannst diesen Promoter ansehen, aber nicht ändern — das dürfen nur Admins.
        </p>
      ) : null}

      <fieldset className={css.sperre} disabled={!darfAendern || laeuft}>
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Promoter</h2>
          <div className={css.raster}>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="name">
                Name
              </label>
              <input
                id="name"
                className={css.eingabe}
                value={stand.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setStand((alt) => ({
                    ...alt,
                    name,
                    kuerzel: kuerzelManuell ? alt.kuerzel : kuerzelAus(name),
                  }));
                  setErfolg(null);
                }}
              />
            </div>
            <div className={css.feld}>
              <label className={css.beschriftung} htmlFor="kuerzel">
                Kürzel im Link
              </label>
              <input
                id="kuerzel"
                className={css.eingabe}
                value={stand.kuerzel}
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  setKuerzelManuell(true);
                  setze("kuerzel", e.target.value.toLowerCase());
                }}
              />
              <span className={css.hinweis}>
                Steht sichtbar im Link (…?promo={stand.kuerzel || "max"}). Nach dem
                Teilen besser nicht mehr ändern — alte Links zählen sonst nicht mehr.
              </span>
            </div>
            <div className={`${css.feld} ${css.breit}`}>
              <label className={css.beschriftung} htmlFor="notiz">
                Notiz (nur intern)
              </label>
              <input
                id="notiz"
                className={css.eingabe}
                value={stand.notiz}
                placeholder="z. B. Handynummer, Uni-Gruppe"
                onChange={(e) => setze("notiz", e.target.value)}
              />
            </div>
          </div>
          <label className={css.schalter}>
            <input
              type="checkbox"
              checked={stand.aktiv}
              onChange={(e) => setze("aktiv", e.target.checked)}
            />
            Aktiv — pausiert zählen weder Klicks noch Käufe
          </label>
          <span className={css.hinweis}>
            Rabatt gibt ein Promoter über einen Code: unter „Rabattcodes“ anlegen und
            dort bei „Gehört zu Promoter“ auswählen.
          </span>
        </section>
      </fieldset>

      {statistikLink ? (
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Geheimer Statistik-Link</h2>
          <KopierFeld
            wert={statistikLink}
            beschriftung="Kopieren"
            kopiert="Kopiert"
            klasse={css.leistungszeile}
            wertKlasse={`${css.eingabe} ${css.linkwert}`}
          />
          <span className={css.hinweis}>
            Ohne Anmeldung: Wer diesen Link hat, sieht Klicks und verkaufte Tickets von{" "}
            {stand.name || "diesem Promoter"} — keine Namen, keinen Umsatz. Dort
            stehen auch seine Links zum Teilen.
          </span>
          {darfAendern ? (
            <div>
              <Knopf stil="linie" groesse="klein" onClick={neuerLink} disabled={laeuft}>
                Neuen Link erzeugen
              </Knopf>
            </div>
          ) : null}
        </section>
      ) : null}

      {links.length > 0 ? (
        <section className={css.gruppe}>
          <h2 className={css.gruppenTitel}>Links zum Teilen</h2>
          {links.map((l) => (
            <div key={l.link} className={css.feld}>
              <span className={css.beschriftung}>
                {l.titel} · {l.datum}
                {l.code ? ` · mit Code ${l.code}` : ""}
              </span>
              <KopierFeld
                wert={l.link}
                beschriftung="Kopieren"
                kopiert="Kopiert"
                klasse={css.leistungszeile}
                wertKlasse={`${css.eingabe} ${css.linkwert}`}
              />
            </div>
          ))}
          <span className={css.hinweis}>
            Gezählt wird, wer über den Link kommt und im selben Besuch kauft. Auf dem
            Handy des Gastes wird dafür nichts gespeichert.
          </span>
        </section>
      ) : null}

      {darfAendern ? (
        <div className={css.fuss}>
          <Knopf onClick={speichern} disabled={laeuft}>
            {laeuft ? "…" : stand.id ? "Speichern" : "Promoter anlegen"}
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
