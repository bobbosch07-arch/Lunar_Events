"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Knopf } from "./Knopf";
import {
  angeboteneKategorien,
  bereinigeAdresse,
  deuteEinwilligung,
  EINWILLIGUNG_GEAENDERT,
  EINWILLIGUNG_OEFFNEN,
  GA_ID,
  istInternerPfad,
  istSauber,
  leseEinwilligung,
  leseKeks,
  META_PIXEL_ID,
  mussFragen,
  speichereEinwilligung,
  type Einwilligung as Wahl,
} from "@/lib/einwilligung";
import { messeKlick } from "@/lib/messen";
import css from "./Einwilligung.module.css";

/** Löscht Cookies eines Werkzeugs auf dieser Domain und der Hauptdomain. */
function loescheKekse(praefixe: string[]) {
  const domain = location.hostname.replace(/^www\./, "");
  for (const teil of document.cookie.split("; ")) {
    const name = teil.split("=")[0];
    if (!praefixe.some((p) => name.startsWith(p))) continue;
    for (const d of ["", `; Domain=${domain}`, `; Domain=.${domain}`]) {
      document.cookie = `${name}=; Max-Age=0; Path=/${d}`;
    }
  }
}

function ladeSkript(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/**
 * GA4 erst nach dem Ja. Seitenaufrufe schicken wir selbst und nur mit
 * bereinigter Adresse (`send_page_view: false`): Wer `/tickets/<token>`
 * öffnet, darf den Token nicht an Google geben. Dazu muss in GA4 unter
 * „Optimierte Analysen“ der Seitenaufruf bei Browserverlauf-Ereignissen aus
 * sein, sonst schickt Google selbst die rohe Adresse (CLAUDE.md, „Tracking“).
 */
function ladeGa(wahl: Wahl) {
  if (!GA_ID || window.gtag) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag erwartet das arguments-Objekt, kein Array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  const werbung = wahl.marketing ? "granted" : "denied";
  window.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: werbung,
    ad_user_data: werbung,
    ad_personalization: werbung,
  });
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, {
    send_page_view: false,
    page_location: bereinigeAdresse(location.href),
    // Auch die Herkunft: Kam der Aufruf von der eigenen Ticketseite, stünde
    // dort sonst der Token. Fremde Herkunft (instagram.com …) bleibt lesbar.
    page_referrer: document.referrer ? bereinigeAdresse(document.referrer) : "",
    allow_google_signals: false,
    allow_ad_personalization_signals: wahl.marketing,
    // Lokale Testläufe landen in GA4 unter „DebugView“ statt als Besucher.
    ...(location.hostname === "localhost" ? { debug_mode: true } : {}),
  });
  ladeSkript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`);
}

/** Meta-Pixel, das übliche Ladeschnipsel, ohne automatische Seitenwechsel. */
function ladeMeta() {
  if (!META_PIXEL_ID || window.fbq) return;
  type Warteschlange = ((...a: unknown[]) => void) & {
    queue: unknown[];
    callMethod?: (...a: unknown[]) => void;
    push: unknown;
    loaded: boolean;
    version: string;
    disablePushState?: boolean;
  };
  const fbq = function (...a: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...a);
    else fbq.queue.push(a);
  } as Warteschlange;
  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  // Sonst meldet Meta jeden Seitenwechsel mit der rohen Adresse.
  fbq.disablePushState = true;
  window.fbq = fbq;
  ladeSkript("https://connect.facebook.net/en_US/fbevents.js");
  fbq("init", META_PIXEL_ID);
}

function meldeSeite() {
  const adresse = bereinigeAdresse(location.href);
  if (window.gtag && GA_ID) {
    window.gtag("set", { page_location: adresse });
    window.gtag("event", "page_view", { page_location: adresse, page_title: document.title });
  }
  if (window.fbq && istSauber(location.href)) window.fbq("track", "PageView");
}

/**
 * Cookie-Banner und alles, was an der Einwilligung hängt. Steht einmal im
 * Layout. Ohne Mess-ID in der Umgebung (`NEXT_PUBLIC_GA_ID`,
 * `NEXT_PUBLIC_META_PIXEL_ID`) gibt es nichts zu fragen, und der Banner
 * erscheint nie.
 */
/** Auf dem Server gibt es kein Cookie zu lesen: dann erst einmal nichts zeigen. */
const SERVER = "\u0000server";

function abonniere(melden: () => void) {
  window.addEventListener(EINWILLIGUNG_GEAENDERT, melden);
  return () => window.removeEventListener(EINWILLIGUNG_GEAENDERT, melden);
}

export function Einwilligung() {
  const t = useTranslations("einwilligung");
  const pfad = usePathname();
  const intern = istInternerPfad(pfad);
  // Das Cookie ist eine Quelle außerhalb von React; so liest React sie
  // ohne Abweichung zwischen Server und Browser beim ersten Zeichnen.
  const keks = useSyncExternalStore(abonniere, leseKeks, () => SERVER);
  const imBrowser = keks !== SERVER;
  const gespeichert = imBrowser ? deuteEinwilligung(keks) : null;
  const [manuell, setManuell] = useState(false);
  const [details, setDetails] = useState(false);
  const [statistik, setStatistik] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const geladen = useRef(false);
  const ersterPfad = useRef(true);
  const angeboten = angeboteneKategorien();
  const offen = !intern && imBrowser && (manuell || mussFragen(gespeichert));

  const wende = useCallback((wahl: Wahl) => {
    if (wahl.statistik) ladeGa(wahl);
    if (wahl.marketing) ladeMeta();
    if (!geladen.current && (wahl.statistik || wahl.marketing)) {
      geladen.current = true;
      meldeSeite();
    }
  }, []);

  // Gespeicherte Wahl anwenden: beim ersten Anzeigen und nach jedem Ja.
  useEffect(() => {
    if (intern || !imBrowser) return;
    const wahl = deuteEinwilligung(keks);
    if (wahl) wende(wahl);
  }, [keks, imBrowser, intern, wende]);

  function zeigeEinstellungen() {
    const wahl = leseEinwilligung();
    setStatistik(wahl?.statistik ?? false);
    setMarketing(wahl?.marketing ?? false);
    setDetails(true);
  }

  // Seitenwechsel innerhalb der App.
  useEffect(() => {
    if (ersterPfad.current) {
      ersterPfad.current = false;
      return;
    }
    if (!intern && geladen.current) meldeSeite();
  }, [pfad, intern]);

  // „Cookie-Einstellungen“ im Fuß.
  useEffect(() => {
    const oeffnen = () => {
      const wahl = leseEinwilligung();
      setStatistik(wahl?.statistik ?? false);
      setMarketing(wahl?.marketing ?? false);
      setDetails(true);
      setManuell(true);
    };
    window.addEventListener(EINWILLIGUNG_OEFFNEN, oeffnen);
    return () => window.removeEventListener(EINWILLIGUNG_OEFFNEN, oeffnen);
  }, []);

  // Klicks auf markierte Knöpfe (data-messen="…").
  useEffect(() => {
    const klick = (e: MouseEvent) => {
      const ziel = (e.target as Element | null)?.closest?.("[data-messen]");
      const name = ziel?.getAttribute("data-messen");
      if (name) messeKlick(name);
    };
    document.addEventListener("click", klick, { capture: true });
    return () => document.removeEventListener("click", klick, { capture: true });
  }, []);

  function entscheide(neu: { statistik: boolean; marketing: boolean }) {
    const vorher = leseEinwilligung();
    const wahl = speichereEinwilligung({
      statistik: neu.statistik && angeboten.includes("statistik"),
      marketing: neu.marketing && angeboten.includes("marketing"),
    });
    setManuell(false);
    setDetails(false);
    // Widerruf: Cookies weg und neu laden, damit die Skripte aus dem
    // Speicher verschwinden. Ein geladenes Skript lässt sich nicht entladen.
    const zurueck =
      (vorher?.statistik && !wahl.statistik) || (vorher?.marketing && !wahl.marketing);
    if (zurueck) {
      if (!wahl.statistik) loescheKekse(["_ga", "_gid"]);
      if (!wahl.marketing) loescheKekse(["_fbp", "_fbc"]);
      location.reload();
      return;
    }
    // Angewendet wird im Effekt oben, sobald das Cookie geschrieben ist.
  }

  if (intern || !offen || angeboten.length === 0) return null;

  return (
    <section className={css.banner} role="dialog" aria-labelledby="einwilligung-titel" data-grund="dunkel">
      <h2 id="einwilligung-titel" className={css.titel}>
        {t("titel")}
      </h2>
      <p className={css.text}>
        {angeboten.includes("marketing") ? t("textMitMarketing") : t("text")}{" "}
        <Link href="/datenschutz" className={css.link}>
          {t("datenschutz")}
        </Link>
      </p>

      {details ? (
        <ul className={css.liste}>
          <li className={css.punkt}>
            <label className={css.schalter}>
              <input type="checkbox" checked disabled />
              <span>
                <strong>{t("notwendigName")}</strong>
                <span className={css.erklaerung}>{t("notwendigText")}</span>
              </span>
            </label>
          </li>
          {angeboten.includes("statistik") ? (
            <li className={css.punkt}>
              <label className={css.schalter}>
                <input
                  type="checkbox"
                  checked={statistik}
                  onChange={(e) => setStatistik(e.target.checked)}
                />
                <span>
                  <strong>{t("statistikName")}</strong>
                  <span className={css.erklaerung}>{t("statistikText")}</span>
                </span>
              </label>
            </li>
          ) : null}
          {angeboten.includes("marketing") ? (
            <li className={css.punkt}>
              <label className={css.schalter}>
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                />
                <span>
                  <strong>{t("marketingName")}</strong>
                  <span className={css.erklaerung}>{t("marketingText")}</span>
                </span>
              </label>
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Annehmen und Ablehnen gleich groß und gleich auffällig: So
          verlangen es die Aufsichtsbehörden. */}
      <div className={css.knoepfe}>
        <Knopf groesse="klein" onClick={() => entscheide({ statistik: true, marketing: true })}>
          {t("alle")}
        </Knopf>
        <Knopf groesse="klein" onClick={() => entscheide({ statistik: false, marketing: false })}>
          {t("notwendig")}
        </Knopf>
      </div>
      {details ? (
        <button type="button" className={css.textknopf} onClick={() => entscheide({ statistik, marketing })}>
          {t("speichern")}
        </button>
      ) : (
        <button type="button" className={css.textknopf} onClick={zeigeEinstellungen}>
          {t("einstellungen")}
        </button>
      )}
    </section>
  );
}

/** Für den Fuß der Seite: öffnet den Banner wieder (Widerruf jederzeit). */
export function EinwilligungAendern({ className }: { className?: string }) {
  const t = useTranslations("einwilligung");
  if (angeboteneKategorien().length === 0) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(EINWILLIGUNG_OEFFNEN))}
    >
      {t("aendern")}
    </button>
  );
}
