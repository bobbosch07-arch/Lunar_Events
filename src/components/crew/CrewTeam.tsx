"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { ROLLEN_NAMEN, type Rolle } from "@/lib/rollen";
import { ABLAGE, lies, schreib } from "@/lib/crew/ablage";

type Teamschicht = {
  id: string;
  userId: string;
  name: string;
  rolle: Rolle;
  station: string | null;
  beginn: string;
  ende: string;
  eingecheckt_am: string | null;
  ausgecheckt_am: string | null;
};

type Was = "ein" | "aus" | "zurueck";
/** Die Uhrzeit kommt vom Gerät: Wer ohne Netz eincheckt, soll ab dann zählen, nicht ab dem Nachtragen. */
type Auftrag = { schichtId: string; was: Was; zeit: number };

const TAKT_MS = 30_000;
const jetzt = () => Date.now();
const uhr = (iso: string | number) =>
  new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

function wende(s: Teamschicht, a: Auftrag): Teamschicht {
  const zeit = new Date(a.zeit).toISOString();
  if (a.was === "ein") return { ...s, eingecheckt_am: zeit, ausgecheckt_am: null };
  if (a.was === "aus") return { ...s, ausgecheckt_am: zeit };
  return { ...s, eingecheckt_am: null, ausgecheckt_am: null };
}

/**
 * „Team heute“ im Plan des Admins: alle Schichten des gewählten Events mit
 * Einchecken und Auschecken. Abgemacht ist, dass ein Admin das für alle macht
 * (0023) — am Abend hat er die Crew-App in der Hand, nicht das Backoffice.
 *
 * Geschrieben wird wie in `setzeAnwesenheit` direkt in `schichten`; das
 * dürfen nur Admins (Zugriffsregel `schichten_pflegen`). Ohne Netz werden die
 * Tipps mit ihrer Uhrzeit gesammelt und in Reihenfolge nachgetragen — für die
 * Stundenabrechnung zählt der Moment des Tippens.
 */
export function CrewTeam({ eventId, online }: { eventId: string; online: boolean }) {
  const db = useRef<ReturnType<typeof browserClient> | null>(null);
  const holeDb = () => (db.current ??= browserClient());
  const [schichten, setSchichten] = useState<Teamschicht[] | null>(null);
  const [offen, setOffenZustand] = useState<Auftrag[]>([]);
  const offenRef = useRef<Auftrag[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Zurücksetzen braucht einen zweiten Tipp — die Zeiten wären sonst weg. */
  const [fragt, setFragt] = useState<string | null>(null);
  const nachtragenLaeuft = useRef(false);

  function setOffen(neu: Auftrag[]) {
    offenRef.current = neu;
    setOffenZustand(neu);
    void schreib(ABLAGE.teamAktionen, neu);
  }

  useEffect(() => {
    let aktiv = true;
    void Promise.all([
      lies<Teamschicht[] | null>(ABLAGE.team(eventId), null),
      lies<Auftrag[]>(ABLAGE.teamAktionen, []),
    ]).then(([liste, auftraege]) => {
      if (!aktiv) return;
      setSchichten((alt) => alt ?? liste);
      offenRef.current = auftraege;
      setOffenZustand(auftraege);
    });
    return () => {
      aktiv = false;
    };
  }, [eventId]);

  const laden = useCallback(async () => {
    const [{ data: zeilen, error }, { data: leute }] = await Promise.all([
      holeDb()
        .from("schichten")
        .select("id, user_id, rolle, station, beginn, ende, eingecheckt_am, ausgecheckt_am")
        .eq("event_id", eventId)
        .order("beginn"),
      holeDb().from("mitarbeiter").select("user_id, name"),
    ]);
    if (error || !zeilen) return;
    const namen = new Map((leute ?? []).map((m) => [m.user_id as string, (m.name as string) ?? ""]));
    const neu: Teamschicht[] = zeilen.map((z) => ({
      id: z.id as string,
      userId: z.user_id as string,
      name: namen.get(z.user_id as string) || "Ohne Namen",
      rolle: z.rolle as Rolle,
      station: (z.station as string | null) ?? null,
      beginn: z.beginn as string,
      ende: z.ende as string,
      eingecheckt_am: (z.eingecheckt_am as string | null) ?? null,
      ausgecheckt_am: (z.ausgecheckt_am as string | null) ?? null,
    }));
    setSchichten(neu);
    void schreib(ABLAGE.team(eventId), neu);
  }, [eventId]);

  const nachtragen = useCallback(async () => {
    if (nachtragenLaeuft.current || offenRef.current.length === 0) return;
    nachtragenLaeuft.current = true;
    try {
      const erledigt: Auftrag[] = [];
      for (const a of offenRef.current) {
        const zeit = new Date(a.zeit).toISOString();
        const werte =
          a.was === "ein"
            ? { eingecheckt_am: zeit, ausgecheckt_am: null }
            : a.was === "aus"
              ? { ausgecheckt_am: zeit }
              : { eingecheckt_am: null, ausgecheckt_am: null };
        const { error } = await holeDb()
          .from("schichten")
          .update({ ...werte, geaendert_am: new Date().toISOString() })
          .eq("id", a.schichtId);
        if (error) {
          // Auschecken ohne Einchecken verbietet die Datenbank; das kommt
          // vor, wenn ein anderer Admin inzwischen zurückgesetzt hat.
          if (error.code === "23514") {
            erledigt.push(a);
            setFehler("Ein Auschecken passte nicht mehr zum Stand. Bitte die Zeile prüfen.");
            continue;
          }
          break;
        }
        erledigt.push(a);
      }
      if (erledigt.length > 0) {
        setOffen(offenRef.current.filter((a) => !erledigt.includes(a)));
        await laden();
      }
    } finally {
      nachtragenLaeuft.current = false;
    }
  }, [laden]);

  useEffect(() => {
    if (!online) return;
    let aus = false;
    const lauf = async () => {
      await nachtragen();
      if (!aus) await laden();
    };
    void lauf();
    const takt = setInterval(() => void lauf(), TAKT_MS);
    return () => {
      aus = true;
      clearInterval(takt);
    };
  }, [online, laden, nachtragen]);

  function tippe(s: Teamschicht, was: Was) {
    setFehler(null);
    setFragt(null);
    if (navigator.vibrate) navigator.vibrate(30);
    setOffen([...offenRef.current, { schichtId: s.id, was, zeit: jetzt() }]);
    if (navigator.onLine) void nachtragen();
  }

  // Was noch nicht nachgetragen ist, zeigt die Liste schon so, wie getippt.
  const anzeige = useMemo(() => {
    const liste = schichten ?? [];
    return liste.map((s) => offen.filter((a) => a.schichtId === s.id).reduce(wende, s));
  }, [schichten, offen]);

  const da = anzeige.filter((s) => s.eingecheckt_am && !s.ausgecheckt_am).length;

  if (schichten === null) return null;

  return (
    <section className="crew-team">
      <span className="crew-team-kopf">
        <h2 className="crew-plan-ueber">Team heute</h2>
        <span className="crew-titel-zahl">
          {da} von {anzeige.length} da{offen.length ? ` · ${offen.length} offen` : ""}
        </span>
      </span>
      {fehler ? (
        <p className="crew-fehler" role="alert">
          {fehler}
        </p>
      ) : null}
      {anzeige.length === 0 ? (
        <p className="crew-plan-stunden">Für dieses Event ist niemand eingeteilt. Geplant wird im Backoffice unter Schichtplan.</p>
      ) : (
        <ul>
          {anzeige.map((s) => {
            const wartet = offen.some((a) => a.schichtId === s.id);
            return (
              <li key={s.id} className="crew-team-zeile">
                <span className="crew-gast-text">
                  <span className="crew-team-name">{s.name}</span>
                  <span className="crew-gast-info">
                    {ROLLEN_NAMEN[s.rolle] ?? s.rolle} · {uhr(s.beginn)} – {uhr(s.ende)}
                    {s.station ? ` · ${s.station}` : ""}
                  </span>
                  {s.eingecheckt_am ? (
                    <span className="crew-gast-status" data-art={s.ausgecheckt_am ? "teil" : "alle"}>
                      <i className={`ph-bold ${wartet ? "ph-cloud-arrow-up" : s.ausgecheckt_am ? "ph-sign-out" : "ph-check-circle"}`} aria-hidden="true" />
                      {s.ausgecheckt_am
                        ? `${uhr(s.eingecheckt_am)} – ${uhr(s.ausgecheckt_am)}`
                        : `Da seit ${uhr(s.eingecheckt_am)}`}
                      {wartet ? " · ohne Netz" : ""}
                    </span>
                  ) : null}
                </span>
                <span className="crew-team-knoepfe">
                  {!s.eingecheckt_am ? (
                    <button type="button" className="btn btn-primary crew-gast-knopf" onClick={() => tippe(s, "ein")}>
                      Einchecken
                    </button>
                  ) : !s.ausgecheckt_am ? (
                    <button type="button" className="btn btn-secondary crew-gast-knopf" onClick={() => tippe(s, "aus")}>
                      Auschecken
                    </button>
                  ) : null}
                  {s.eingecheckt_am ? (
                    fragt === s.id ? (
                      <button type="button" className="btn btn-secondary crew-gast-knopf" onClick={() => tippe(s, "zurueck")}>
                        Zurücksetzen?
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost crew-team-zurueck"
                        aria-label={`${s.name}: Ein- und Auschecken zurücksetzen`}
                        onClick={() => setFragt(s.id)}
                      >
                        <i className="ph-bold ph-arrow-counter-clockwise" aria-hidden="true" />
                      </button>
                    )
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
