"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Knopf } from "./Knopf";
import { browserClient } from "@/lib/supabase/client";
import { spaeterMitZweitemFaktor } from "@/app/aktionen/konto";
import css from "./Anmeldung.module.css";


/**
 * Supabase liefert den QR-Code als Daten-URL mit rohem SVG darin.
 * next/image lehnt die ab (sie ist nicht kodiert), also packen wir das SVG
 * aus und zeichnen es direkt.
 */
function svgAus(datenUrl: string): string {
  const komma = datenUrl.indexOf(",");
  if (!datenUrl.startsWith("data:image/svg+xml") || komma < 0) return "";
  const inhalt = datenUrl.slice(komma + 1);
  try {
    return decodeURIComponent(inhalt);
  } catch {
    return inhalt;
  }
}

type Stand =
  | { art: "laedt" }
  | { art: "einrichten"; faktorId: string; qr: string; geheim: string }
  | { art: "code"; faktorId: string }
  | { art: "fertig" }
  | { art: "fehler"; text: string };

/**
 * Der zweite Faktor: ein Einmalcode aus einer App (Google Authenticator,
 * 1Password, was auch immer).
 *
 * Pflicht für alle, die an Geld oder Kundendaten kommen — Admin und Kasse
 * (Fragebogen 16.09.2026). Die Prüfung steht in der Datenbank
 * (`ist_mitarbeiter`, Migration 0022); diese Komponente richtet nur ein und
 * fragt den Code ab. Beides läuft im Browser gegen Supabase, der Code geht
 * nie über unseren Server.
 */
export function ZweiFaktor({
  art,
  pflicht = true,
}: {
  /** "tor" versperrt das Backoffice, "verwalten" steht unter „Mein Zugang". */
  art: "tor" | "verwalten";
  /** Greift die Pflicht schon? Sonst darf man sie vertagen. */
  pflicht?: boolean;
}) {
  const router = useRouter();
  const [stand, setStand] = useState<Stand>({ art: "laedt" });
  const [code, setCode] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const einrichten = useCallback(async () => {
    const sb = browserClient();
    // Angefangene, nie bestätigte Einrichtungen wegräumen — sonst scheitert
    // die neue am doppelten Namen.
    const { data: vorhanden } = await sb.auth.mfa.listFactors();
    for (const faktor of vorhanden?.all ?? []) {
      if (faktor.status !== "verified") await sb.auth.mfa.unenroll({ factorId: faktor.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Lunar ${new Date().toISOString().slice(0, 16)}`,
    });
    if (error || !data) {
      setStand({ art: "fehler", text: error?.message ?? "Einrichtung nicht möglich." });
      return;
    }
    setStand({
      art: "einrichten",
      faktorId: data.id,
      qr: data.totp.qr_code,
      geheim: data.totp.secret,
    });
  }, []);

  useEffect(() => {
    let abgebrochen = false;
    void (async () => {
      const sb = browserClient();
      const { data, error } = await sb.auth.mfa.listFactors();
      if (abgebrochen) return;
      if (error) {
        setStand({ art: "fehler", text: error.message });
        return;
      }
      const bestaetigt = (data?.totp ?? []).find((f) => f.status === "verified");
      if (bestaetigt) {
        // Eingerichtet, aber diese Anmeldung ist noch ohne Code.
        if (art === "verwalten") setStand({ art: "fertig" });
        else setStand({ art: "code", faktorId: bestaetigt.id });
        return;
      }
      await einrichten();
    })();
    return () => {
      abgebrochen = true;
    };
  }, [art, einrichten]);

  async function bestaetigen() {
    if (stand.art !== "einrichten" && stand.art !== "code") return;
    const sauber = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(sauber)) {
      setFehler("Der Code besteht aus sechs Ziffern.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const sb = browserClient();
    const { error } = await sb.auth.mfa.challengeAndVerify({
      factorId: stand.faktorId,
      code: sauber,
    });
    setLaeuft(false);
    if (error) {
      setFehler(
        error.message.toLowerCase().includes("invalid")
          ? "Der Code stimmt nicht. Er wechselt alle 30 Sekunden — nimm den aktuellen."
          : error.message,
      );
      return;
    }
    setCode("");
    setStand({ art: "fertig" });
    router.refresh();
  }

  async function neuEinrichten() {
    const sicher = window.confirm(
      "Zweiten Faktor neu einrichten? Der alte Code aus deiner App gilt danach nicht mehr.",
    );
    if (!sicher) return;
    setFehler(null);
    setStand({ art: "laedt" });
    const sb = browserClient();
    const { data } = await sb.auth.mfa.listFactors();
    for (const faktor of data?.all ?? []) await sb.auth.mfa.unenroll({ factorId: faktor.id });
    await einrichten();
  }

  if (stand.art === "laedt") {
    return <p className={css.text}>Einen Moment …</p>;
  }

  if (stand.art === "fehler") {
    return (
      <div className={css.karte}>
        <h2 className={css.titel} style={{ fontSize: "1.5rem" }}>
          Zwei-Faktor-Anmeldung
        </h2>
        <p className={css.text}>{stand.text}</p>
      </div>
    );
  }

  if (stand.art === "fertig") {
    return (
      <div className={css.karte}>
        <h2 className={css.titel} style={{ fontSize: "1.5rem" }}>
          Zwei-Faktor-Anmeldung
        </h2>
        <p className={css.text}>
          Eingerichtet. Beim Anmelden fragen wir zusätzlich nach dem Code aus deiner App.
        </p>
        {art === "verwalten" ? (
          <div>
            <Knopf stil="linie" onClick={neuEinrichten}>
              Neu einrichten
            </Knopf>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={css.karte}>
      <h2 className={css.titel} style={{ fontSize: "1.5rem" }}>
        {stand.art === "einrichten" ? "Zwei-Faktor-Anmeldung einrichten" : "Code aus deiner App"}
      </h2>

      {stand.art === "einrichten" ? (
        <>
          <p className={css.text}>
            Scanne den Code mit einer Authenticator-App (Google Authenticator, 1Password,
            Apple Passwörter). Sie zeigt dann alle 30 Sekunden eine neue sechsstellige Zahl.
          </p>
          <div
            className={css.qr}
            role="img"
            aria-label="QR-Code für die Authenticator-App"
            // Das SVG kommt von Supabase, nicht aus einer Eingabe — wie bei
            // den Ticket-QR-Codes fließt hier kein fremder Text ein.
            dangerouslySetInnerHTML={{ __html: svgAus(stand.qr) }}
          />
          <p className={css.text} style={{ fontSize: "0.875rem" }}>
            Ohne Kamera: Schlüssel von Hand eintippen — <code>{stand.geheim}</code>
          </p>
        </>
      ) : (
        <p className={css.text}>
          Gib die sechsstellige Zahl aus deiner Authenticator-App ein.
        </p>
      )}

      <div className={css.feld}>
        <label className={css.beschriftung} htmlFor="zwei-faktor-code">
          Code
        </label>
        <input
          id="zwei-faktor-code"
          className={css.eingabe}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setFehler(null);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          spellCheck={false}
        />
      </div>

      {fehler ? (
        <p className={css.fehlertext} role="alert">
          {fehler}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Knopf onClick={bestaetigen} disabled={laeuft}>
          {laeuft ? "…" : "Bestätigen"}
        </Knopf>
        {art === "tor" && stand.art === "einrichten" && !pflicht ? (
          <Knopf
            stil="linie"
            onClick={async () => {
              await spaeterMitZweitemFaktor();
              router.refresh();
            }}
          >
            Später
          </Knopf>
        ) : null}
      </div>

      {art === "tor" && stand.art === "einrichten" ? (
        <p className={css.text} style={{ fontSize: "0.875rem" }}>
          {pflicht
            ? "Ohne zweiten Faktor kommst du nicht mehr ins Backoffice — so kommt auch niemand sonst mit einem geklauten Passwort hinein."
            : "Noch ist es freiwillig. Sobald ihr beide eingerichtet habt, schalten wir die Pflicht ein."}
        </p>
      ) : null}
    </div>
  );
}
