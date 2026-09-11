# Lunar Events — Ticketing

Website und Handy-Oberflächen für **Lunar Events**, ein Veranstalter für
gehobene Nightlife-Events (Frankfurt, Mannheim, Stuttgart). Zielgruppe
18–30. Tickets werden online verkauft, am Einlass gescannt, VIP wird
angefragt statt gekauft.

Das Markenbriefing des Kunden ist Gesetz. Es steht in
[`docs/briefing.md`](docs/briefing.md) — bei gestalterischen Fragen gilt
es vor allem anderen.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- **Vanilla-CSS mit Design-Tokens, kein Tailwind.** Das Briefing verbietet
  willkürliche Farben, Schriftgrade und Radien; ein Token-System in reinem
  CSS ist die direkteste Form davon.
- Supabase (Auth + Postgres) — Migrationen in `supabase/migrations/`
- next-intl, Deutsch ohne Präfix, Englisch unter `/en`
- Bezahlung: Stripe **und** PayPal (beides, nicht entweder/oder)

## Befehle

```bash
npm run dev      # Entwicklung auf :3000
npm run build    # prüft auch die Typen
npm run lint
```

Die Vorschau im Browser-Pane greift auf `.claude/launch.json` manchmal die
falsche Konfiguration — dann `npm run dev` im Hintergrund starten und die
Seite über `preview_start` mit `url` öffnen.

## Gestaltung — bitte nicht neu erfinden

- **Gewählte Richtung: 03 „Contemporary Nightlife"** (Syne + DM Sans),
  vom Kunden aus drei Lookboards ausgewählt. Die Lookboards stehen in
  [`docs/lookboards.html`](docs/lookboards.html), der Generator daneben in
  `scripts/lookboards.py`. Die beiden verworfenen Richtungen (Jost +
  Manrope, Bodoni Moda + Work Sans) sind dort dokumentiert — nicht
  versehentlich wiederbeleben.
- **Alle Tokens stehen in `src/styles/tokens.css`.** Komponenten greifen
  nur darauf zu. Keine eigenen Farben, keine eigenen Schriftgrade, keine
  eigenen Radien — das ist die härteste Regel im Briefing.
- **Dunkle Abschnitte laufen über `data-grund`**, nicht über eigene
  Dunkel-Varianten je Komponente: `<section data-grund="dunkel">` (oder
  `"tief"`, `"gedaempft"`) schreibt die semantischen Tokens um — `--grund`,
  `--auf-grund`, `--linie`, `--akzent-text`. Jede Komponente, die
  ausschließlich diese Namen benutzt, funktioniert dadurch auf beiden
  Gründen ohne eine Zeile Zusatz. Wer stattdessen `--navy-900` direkt in
  eine Komponente schreibt, bricht das.
- **Gold ist Schmuck, keine Fläche.** Linien, Trenner, aktive Zustände,
  VIP. Keine großen goldenen Flächen, kein dauerhaftes Leuchten. Und:
  Gold darf nie das *einzige* Merkmal eines Zustands sein — die aktive
  Navigation trägt zusätzlich Gewicht, der Fokusring zusätzlich Dicke.
- **Das Logo wird nicht nachgebaut.** Es liegt in `assets/logo/` und
  `public/logo/` in drei Einfärbungen (gold, ivory, navy) plus Bildmarke
  allein. Erzeugt aus `lunar-outline.png`, die bereits einen sauberen
  Alphakanal hatte — nur eingefärbt, Geometrie unangetastet
  (`scripts/logo_varianten.py`). Das Lockup ist **quadratisch**
  (Mond über Schriftzug): unter ~44 px Höhe ist der Schriftzug nicht mehr
  lesbar. Deshalb ist die Kopfzeile 92 px hoch — nicht aus Laune.
- **Preise ohne Kassenbon-Nullen:** `preisText()` in `src/lib/format.ts`
  setzt glatte Beträge als „29 €", krumme als „29,50 €".
- **Keine erfundene Knappheit.** Restmengen werden nur angezeigt, wenn sie
  echt knapp sind (`KNAPP_AB` in `src/lib/typen.ts`). Ausverkaufte Phasen
  bleiben sichtbar — das ist Transparenz, nicht Druck.

## Daten

- **Alle Texte liegen in `src/messages/{de,en}.json`.** Keine Zeichenkette
  fest in eine Komponente schreiben, auch keine scheinbar einmalige.
- **`src/lib/typen.ts` ist die Wahrheit über die Begriffe.** Die
  Migrationen bilden diese Typen ab, nicht umgekehrt.
- **Events kommen aus `src/lib/events.ts`** — eine Stelle. Solange keine
  Supabase-Zugangsdaten gesetzt sind, liefert sie die Beispielwelt aus
  `src/lib/beispieldaten.ts`. Beim Umstieg wird nur der Rumpf dieser
  Funktionen ersetzt, keine Komponente.
- **Preise stehen in Cent**, nie als Fließkommazahl.

## Verkauf — der Kern

**Überverkauf wird in der Datenbank verhindert, nicht im Anwendungscode.**
Wer erst zählt und dann bucht, verkauft beim letzten Ticket eines zu viel:
zwischen Zählen und Buchen liegt immer eine Lücke. Deshalb macht
`reserviere()` (`0002_reservierung.sql`) beides in einer Transaktion mit
`select … for update` auf der Phase. Zusätzlich steht die Obergrenze als
`check`-Regel in der Tabelle — die Datenbank ist der letzte Ort, an dem es
noch jemand merkt.

**Tickets entstehen erst bei bezahlter Bestellung** (`bestaetige_zahlung`),
nicht bei der Reservierung. Ein Ticket, das nie bezahlt wurde, soll nie
existiert haben. Die Funktion ist mehrfach aufrufbar, ohne doppelte
Tickets zu erzeugen — Zahlungsanbieter melden denselben Vorgang gern
zweimal.

**Reservierungen verfallen** (`reserviert_bis`, voreingestellt 15 Minuten);
`raeume_reservierungen_auf()` gibt die Kontingente zurück.

**`entwerte_ticket()` wirft nie eine Ausnahme**, sondern antwortet immer
mit einem Ergebnis (`gueltig`, `schon_entwertet`, `storniert`, `unbekannt`,
`keine_berechtigung`). Am Eingang steht jemand und wartet — da hilft ein
Fehler niemandem, die Person am Gerät muss sofort sehen, was los ist.

**Gastkäufe sind vorgesehen**: `kunden.user_id` bleibt dann null. Solche
Bestellungen sind über die Zugriffsregeln **nicht** lesbar; die
Bestätigungsseite läuft serverseitig mit dem Dienstschlüssel.

## Stand

Fertig: Design-Tokens, Logo-Varianten, i18n-Gerüst, Kopf- und Fußzeile,
Event-Karte, VIP-Sektion, Startseite, Datenbankschema mit Zugriffsregeln
und Verkaufslogik.

Offen, in dieser Reihenfolge sinnvoll:

1. **Supabase-Projekt anlegen** und Migrationen einspielen. Danach
   `src/lib/events.ts` auf echte Abfragen umstellen.
2. **Eventdetail** mit Ticketauswahl (Phasen, Abendkasse-Block).
3. **Checkout** in vier Schritten, Stripe + PayPal.
4. **Konto und „Meine Tickets"** (Anmeldung per Magic Link).
5. **Wallet-Pässe**: Apple (.pkpass, braucht Apple-Developer-Zertifikat)
   und Google Wallet (Service Account). Samsung liest Google-Pässe.
6. **Einlass-Scanner** als PWA, offline-fähig — im Clubkeller gibt es kein
   Netz. Muss Codes lokal puffern und später abgleichen.
7. **Backoffice**: Events anlegen, Verkaufszahlen, VIP-Anfragen.
8. Rechtstexte (AGB, Datenschutz, Impressum), Consent, Tracking.

Noch nicht entschieden: echte Eventfotos (aktuell Verlaufsflächen als
Platzhalter — sie tragen später die halbe Gestaltung), Domain,
Firmendaten fürs Impressum, Stripe- und PayPal-Konten.
