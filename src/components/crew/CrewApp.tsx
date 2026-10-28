"use client";

import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { darfScannen, istRolle, type Rolle } from "@/lib/rollen";
import { ABLAGE, lies, schreib } from "@/lib/crew/ablage";
import { meldeCrewAn } from "@/app/aktionen/crew";
import { sendeAnmeldelink } from "@/app/aktionen/konto";
import { CrewScanner, type CrewEvent } from "./CrewScanner";

type Person = { id: string; email: string; name: string | null; rolle: Rolle };

type Zustand =
  | { art: "laedt" }
  | { art: "anmelden" }
  | { art: "kein_zugang"; email: string; rolle: Rolle | null }
  | { art: "bereit"; person: Person };

/**
 * Die Crew-App unter /crew: eine Seite, die ohne Server auskommt, sobald sie
 * einmal geladen ist. Deshalb prüft sie Anmeldung und Rolle im Browser statt
 * auf dem Server wie /einlass — eine vom Server gebaute Seite gäbe es ohne
 * Netz nicht. Die Rolle wird zusätzlich in der Ablage gemerkt, damit die App
 * auch offline startet. Was sie darf, entscheidet weiter die Datenbank.
 */
export function CrewApp() {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const holeDb = () => (db.current ??= browserClient());
  const [zustand, setZustand] = useState<Zustand>({ art: "laedt" });
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [eventId, setEventIdState] = useState("");

  // Service Worker: die App selbst für den Start ohne Netz.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/crew-sw.js", { scope: "/crew" }).catch(() => {
        // Ohne Service Worker läuft die App trotzdem, nur nicht ohne Netz.
      });
    }
  }, []);

  useEffect(() => {
    let aktiv = true;
    void (async () => {
      // getSession liest nur das Gerät — geht ohne Netz.
      const { data } = await holeDb().auth.getSession();
      const nutzer = data.session?.user;
      if (!nutzer) {
        if (aktiv) setZustand({ art: "anmelden" });
        return;
      }
      const gemerkt = await lies<Person | null>(ABLAGE.person, null);
      if (!navigator.onLine) {
        if (!aktiv) return;
        setZustand(gemerkt?.id === nutzer.id ? { art: "bereit", person: gemerkt } : { art: "anmelden" });
        return;
      }
      const { data: m, error } = await holeDb()
        .from("mitarbeiter")
        .select("name, rolle, aktiv")
        .eq("user_id", nutzer.id)
        .maybeSingle();
      if (!aktiv) return;
      if (error) {
        // Netz gemeldet, aber keine Antwort: wie ohne Netz.
        setZustand(gemerkt?.id === nutzer.id ? { art: "bereit", person: gemerkt } : { art: "anmelden" });
        return;
      }
      const rolle = istRolle(m?.rolle) ? m.rolle : null;
      if (!m?.aktiv || !rolle || !darfScannen(rolle)) {
        setZustand({ art: "kein_zugang", email: nutzer.email ?? "", rolle });
        return;
      }
      const person: Person = { id: nutzer.id, email: nutzer.email ?? "", name: m.name ?? null, rolle };
      void schreib(ABLAGE.person, person);
      setZustand({ art: "bereit", person });
    })();
    return () => {
      aktiv = false;
    };
  }, []);

  // Events: wie holeEventsFuerDenAbend, aber aus dem Browser.
  const istAdmin = zustand.art === "bereit" && zustand.person.rolle === "admin";
  useEffect(() => {
    if (zustand.art !== "bereit") return;
    let aktiv = true;
    void (async () => {
      const gemerkt = await lies<CrewEvent[]>(ABLAGE.events, []);
      const wahl = await lies<string>(ABLAGE.eventWahl, "");
      const uebernehmen = (liste: CrewEvent[]) => {
        if (!aktiv) return;
        setEvents(liste);
        setEventIdState((jetzt) =>
          liste.some((e) => e.id === jetzt) ? jetzt : liste.some((e) => e.id === wahl) ? wahl : (liste[0]?.id ?? ""),
        );
      };
      uebernehmen(gemerkt);
      if (!navigator.onLine) return;
      // Wer um 23 Uhr beginnt, ist bis in den Morgen in Betrieb.
      const seit = new Date(Date.now() - 18 * 3_600_000).toISOString();
      const { data, error } = await holeDb()
        .from("events")
        .select("id, titel, beginn, status")
        .in("status", istAdmin ? ["veroeffentlicht", "entwurf"] : ["veroeffentlicht"])
        .gt("beginn", seit)
        .order("beginn", { ascending: true });
      if (error || !data) return;
      const liste = data.map((e) => ({
        id: e.id as string,
        titel: e.titel as string,
        wann: new Date(e.beginn as string).toLocaleString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
        entwurf: e.status === "entwurf",
      }));
      void schreib(ABLAGE.events, liste);
      uebernehmen(liste);
    })();
    return () => {
      aktiv = false;
    };
  }, [zustand.art, istAdmin]);

  function setEventId(id: string) {
    setEventIdState(id);
    void schreib(ABLAGE.eventWahl, id);
  }

  async function abmelden() {
    await holeDb().auth.signOut();
    void schreib(ABLAGE.person, null);
    setZustand({ art: "anmelden" });
  }

  if (zustand.art === "laedt") {
    return (
      <main className="crew-tor" aria-busy="true">
        <img src="/crew/lunar-events-wortmarke.png" alt="Lunar Events" width={220} className="crew-wortmarke" />
      </main>
    );
  }

  if (zustand.art === "anmelden") {
    return <CrewAnmeldung onFertig={() => window.location.reload()} />;
  }

  if (zustand.art === "kein_zugang") {
    return (
      <main className="crew-tor">
        <img src="/crew/lunar-events-wortmarke.png" alt="Lunar Events" width={220} className="crew-wortmarke" />
        <div className="card elev-sm crew-tor-karte">
          <span className="card-kicker">Kein Zugang</span>
          <p className="card-body">
            {zustand.rolle
              ? "Mit dieser Rolle scannst du keine Tickets. Scannen dürfen Einlass, Bar und Kasse."
              : `Dieses Konto (${zustand.email}) ist nicht fürs Personal freigeschaltet. Melde dich bei der Veranstaltungsleitung.`}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void abmelden()}>
            Abmelden
          </button>
        </div>
      </main>
    );
  }

  if (events.length === 0 || !eventId) {
    return (
      <main className="crew-tor">
        <img src="/crew/lunar-events-wortmarke.png" alt="Lunar Events" width={220} className="crew-wortmarke" />
        <div className="card elev-sm crew-tor-karte">
          <span className="card-kicker">Kein Event</span>
          <p className="card-body">
            {navigator.onLine
              ? "Zurzeit ist keine Veranstaltung angesetzt, für die gescannt werden könnte."
              : "Ohne Netz und noch keine Events auf diesem Gerät. Einmal mit Netz öffnen."}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void abmelden()}>
            Abmelden
          </button>
        </div>
      </main>
    );
  }

  return <CrewScanner key={eventId} events={events} eventId={eventId} setEventId={setEventId} abmelden={() => void abmelden()} />;
}

function CrewAnmeldung({ onFertig }: { onFertig: () => void }) {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [linkGesendet, setLinkGesendet] = useState(false);

  async function anmelden(e: React.FormEvent) {
    e.preventDefault();
    if (laeuft) return;
    if (!navigator.onLine) {
      setFehler("Zum Anmelden braucht das Gerät einmal Netz.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const antwort = await meldeCrewAn(email, passwort);
    if (antwort.ok) {
      onFertig();
      return;
    }
    setLaeuft(false);
    setFehler(
      antwort.fehler === "falsch"
        ? "Mail oder Passwort stimmt nicht."
        : antwort.fehler === "zu_oft"
          ? "Zu viele Versuche. Warte ein paar Minuten."
          : antwort.fehler === "kein_team"
            ? "Dieses Konto ist nicht fürs Scannen freigeschaltet."
            : "Das hat nicht geklappt. Versuch es bitte noch einmal.",
    );
  }

  async function linkAnfordern() {
    if (laeuft) return;
    if (!email.trim()) {
      setFehler("Erst die Mailadresse eintragen.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const antwort = await sendeAnmeldelink(email, "/crew/passwort");
    setLaeuft(false);
    if (antwort.ok) setLinkGesendet(true);
    else setFehler(antwort.fehler === "zu_oft" ? "Zu viele Versuche. Warte ein paar Minuten." : "Die Mail ging nicht raus.");
  }

  return (
    <main className="crew-tor">
      <img src="/crew/lunar-events-wortmarke.png" alt="Lunar Events" width={220} className="crew-wortmarke" />
      <form className="crew-anmelden" onSubmit={anmelden}>
        <h1 className="crew-anmelden-titel">Crew</h1>
        <div className="field">
          <label htmlFor="crew-mail">E-Mail</label>
          <input
            id="crew-mail"
            className="input"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="crew-passwort">Passwort</label>
          <input
            id="crew-passwort"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={passwort}
            onChange={(e) => setPasswort(e.target.value)}
          />
        </div>
        {fehler ? (
          <p className="crew-fehler" role="alert">
            {fehler}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary crew-hauptknopf" disabled={laeuft}>
          Anmelden
        </button>
        {linkGesendet ? (
          <p className="crew-hinweis">
            Link ist unterwegs an {email}. Öffne ihn in Safari, leg dort dein Passwort fest und melde dich dann hier an.
          </p>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => void linkAnfordern()} disabled={laeuft}>
            Noch kein Passwort? Link anfordern
          </button>
        )}
      </form>
    </main>
  );
}
