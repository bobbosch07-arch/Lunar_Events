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

npx supabase db push          # Migrationen einspielen (braucht SUPABASE_ACCESS_TOKEN)
node scripts/testdaten.mjs    # Testwelt anlegen, --weg entfernt sie
node scripts/mitarbeiter.mjs  # Personal auflisten/anlegen
node scripts/zahlung-testen.mjs    # Stripe-Kauf ohne Browser durchspielen
node scripts/einlass-testen.mjs    # Entwerten mit echter Anmeldung
node scripts/backoffice-testen.mjs # Zugriffsregeln fürs Backoffice
```

**`/api/status` sagt, womit eine Auslieferung wirklich verbunden ist** —
Datenbank, Stripe, Mailversand, gefundene Variablennamen. Entstanden,
nachdem die öffentliche Seite eine Weile Beispieldaten zeigte, weil in
Vercel die Zugangsdaten fehlten. Von außen sah alles normal aus.

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

**Phasen laufen nacheinander.** Kaufbar ist immer nur die erste
Standardphase (nach `position`, bei Gleichstand ID), die noch Tickets hat;
spätere stehen sichtbar als „Nach Early Bird“ da. `phasenZustand` beurteilt
eine Phase allein und reicht dafür nicht — Anzeigeflächen nehmen
**`phasenZustaende(phasen)`** (`src/lib/typen.ts`). Die Datenbank prüft
dasselbe in `reserviere()` (0010), weil die Auswahl in der Adresse steht.
Eine Phase ohne Kontingent ist nie ausverkauft; danach kommt eine spätere
nur über `bis`, `aktiv` oder ein Zeitfenster dran.

**Die Verkaufsleiste zeigt nur echte Zahlen** (`verkaufsstand`): Anteil
verkauft und Preis der nächsten Phase, erst ab 50 %, ab 80 % in
Warnfarbe. Das Briefing erlaubt Dringlichkeit nur aus wahrheitsgemäßer
Verfügbarkeit — nie erfundene Zahlen, keine Countdowns.

**Reservierungen verfallen** (`reserviert_bis`, voreingestellt 15 Minuten);
`raeume_reservierungen_auf()` gibt die Kontingente zurück.

**`entwerte_ticket()` wirft nie eine Ausnahme**, sondern antwortet immer
mit einem Ergebnis (`gueltig`, `schon_entwertet`, `storniert`, `unbekannt`,
`keine_berechtigung`). Am Eingang steht jemand und wartet — da hilft ein
Fehler niemandem, die Person am Gerät muss sofort sehen, was los ist.

**Gastkäufe sind vorgesehen**: `kunden.user_id` bleibt dann null. Solche
Bestellungen sind über die Zugriffsregeln **nicht** lesbar; die
Bestätigungsseite läuft serverseitig mit dem Dienstschlüssel.

## Zahlung

**Der Webhook ist die einzige Quelle, der wir glauben** (`api/stripe/webhook`).
Der Browser kann behaupten, was er will — er lässt sich manipulieren, er
stürzt ab, der Gast schließt den Tab. Der Webhook kommt trotzdem. Die
Signatur wird gegen den **rohen** Text geprüft, nicht gegen geparstes
JSON.

Weil der Gast oft schneller zurück ist als die Meldung, fragt die
Bestätigungsseite zusätzlich selbst bei Stripe nach
(`stelleZahlungSicher`). Doppelt bestätigen ist gefahrlos, weil
`bestaetige_zahlung` mehrfach aufrufbar ist.

**Der Betrag kommt immer aus der Datenbank**, nie aus dem Browser. Pro
Bestellung entsteht nur ein Zahlungsvorgang, auch beim Neuladen —
sonst stünden zwei offene Zahlungen für eine Bestellung in Stripe.

Getestet wird ohne Browser (`scripts/zahlung-testen.mjs`): Das
Zahlformular liegt in einem Stripe-iframe, in den sich von außen keine
Testkarte tippen lässt. Der iframe ist Stripes Code; unsere Seite ist
das, was geprüft werden muss.

## Einlass

**Der Scanner läuft auch ohne Netz.** Er lädt vorab **Prüfsummen** der
gültigen Ticketcodes — bewusst nicht die Codes selbst: So kann das Gerät
sagen „dieser Code gehört zu diesem Event", aber aus einem verlorenen
Telefon lassen sich keine Tickets herstellen. Entwertungen werden
gepuffert und nachgereicht.

**Die Rolle steht in der Datenbank, nicht im Token.** Wer entzogen wird,
kommt sofort nicht mehr durch, ohne dass eine Sitzung ablaufen muss.

Personal legt `scripts/mitarbeiter.mjs` an — es gibt bewusst keine
Oberfläche dafür. Wer Personal anlegen darf, bestimmt, wer an die Kasse
kommt.

## Wallet-Pässe

Beide Anbieter sind gebaut und warten nur auf Zugangsdaten — die Schritte
dafür stehen in [`docs/wallet.md`](docs/wallet.md).

**Die Knöpfe erscheinen nur, wenn der jeweilige Zugang eingerichtet ist**
(`appleEingerichtet()`, `googleEingerichtet()`), wie beim Testkauf und
beim Mailversand. Ein Knopf, der zu einer Fehlermeldung führt, ist
schlimmer als keiner.

Zwei Fallen, die `scripts/wallet-testen.mjs` gefunden hat, bevor
Zertifikate im Spiel waren:

- **`passkit-generator` nimmt kein `.p12` entgegen**, sondern zwei
  getrennte PEM-Blöcke. `zerlegeP12()` macht das.
- **Eine leere Passphrase wird abgelehnt.** Der herausgelöste Schlüssel
  wird deshalb sofort wieder verschlüsselt, mit einer Zufallsphrase, die
  den Prozess nie verlässt.

Der Zugang zu einem Pass braucht **Ticketcode und Zugangstoken der
Bestellung**. Der Code allein genügt nicht: Er steht im QR und wird am
Einlass herumgezeigt.

**Apple-Pässe hängen an der Ticketmail** (bis sechs Stück; darüber wird
die Mail zu schwer). Google geht nur über den Link auf der Ticketseite.

**Das Apple-Signaturzertifikat gilt 398 Tage.** Die Backoffice-Übersicht
warnt ab 45 Tagen vorher — sonst fällt das mitten im Vorverkauf auf.

## Auswertung

**Gezählt wird ohne Personenbezug** — keine IP, keine Kennung, kein
Cookie, Zeitstempel auf die Stunde gerundet (`ereignisse`,
Migration 0009). Deshalb braucht die Auswertung keinen
Einwilligungsdialog.

Der Preis dafür steht auch auf der Seite: Das sind **Aufrufe, keine
Besucher**. Wer zweimal hinschaut, zählt zweimal. Für „welches Event
zieht besser?" reicht das, für „wie viele verschiedene Leute?" nicht.
Wer das später braucht, kommt um einen Einwilligungsdialog nicht herum.

Gemeldet wird über `sendBeacon` (`src/components/Zaehler.tsx`), damit
ein Seitenwechsel die Meldung nicht abschneidet. Bots werden am
User-Agent grob aussortiert — sie sehen Seiten an und kaufen nie, was
die Quote sonst verzerrt.

## Backoffice — warum es so gebaut ist

**Der Rahmen ist ein Layout** (`src/app/[locale]/backoffice/layout.tsx`),
keine Komponente, die jede Seite selbst aufruft. Vorher lief bei jedem
Reiterwechsel alles von vorn: Sitzung beim Auth-Server nachprüfen,
Mitarbeiterzeile laden, Kopf neu bauen — zwei Netzwerkrunden, bevor die
eigentliche Abfrage überhaupt begann. Ein Layout wird beim Wechsel
zwischen Geschwisterseiten **nicht neu gerechnet**; Next lädt nur den
Teil, der sich ändert. Die Rechteprüfung steht damit weiterhin an genau
einer Stelle. Wer eine neue Backoffice-Seite anlegt, braucht sie nicht
zu wiederholen.

**Jede Seite trennt Titel und Daten.** Die Titelzeile (`BackofficeKopf`)
weiß nichts von der Datenbank und steht sofort da; der Inhalt hängt in
einer `<Suspense>`-Grenze mit `BackofficeSkelett`. Dazu kommt
`loading.tsx` — dessen zweiter Zweck ist der wichtigere: Erst dadurch
kann Next beim Vorausladen eines Reiters überhaupt etwas ablegen. Eine
Seite, die bei jedem Aufruf die Datenbank fragt, lässt sich nicht
vorausladen; ihre Ladeansicht schon.

**Die Reiter sind eine Client-Komponente** (`BackofficeReiter`) — nicht
wegen `usePathname`, der weiß es genauso spät wie der Server, sondern
wegen `useLinkStatus`. Daran hängt `:has(.ladepunkt[data-laeuft])` im
Stylesheet: Der angeklickte Reiter sieht **sofort** aktiv aus, der alte
tritt zurück. Ohne das wirkte ein Klick auf eine Abfrage, die eine
Sekunde braucht, wie ein verschluckter Klick.

**Gezählt wird in der Datenbank.** `holeKennzahlen()` holte einmal
*alle* Bestellungen und *alle* Tickets, um vier Zahlen zu bilden. Jetzt
`select("id", { count: "exact", head: true })` — das überträgt keine
Zeilen. Die Umsatzsumme ist die Ausnahme: Summieren kann PostgREST ohne
eigene Datenbankfunktion nicht. `holeEventZeilen({ abJetzt, grenze })`
lädt für die Übersicht nur die sechs kommenden Events statt der
gesamten Historie.

### Anmeldung fürs Team

**Gäste melden sich per Link an, das Team zusätzlich mit Passwort.** Das
Backoffice-Tor zeigt die Passwort-Anmeldung (`Anmeldung mitPasswort`),
gesetzt wird es unter „Mein Zugang" (`/backoffice/zugang`). Beide
Server-Aktionen prüfen die Rolle: Wer mit Passwort hereinkommt, aber nicht
(mehr) zum Team gehört, wird sofort wieder abgemeldet — sonst ginge das
Passwort am Rollenentzug vorbei. Ob ein Passwort existiert, verrät Supabase
nicht; `user_metadata.passwort_gesetzt` ist nur für die Beschriftung da.

**Ausgestellte Links führen über `/anmelden`**, eine Zwischenseite mit
Knopf. Messenger rufen Adressen für ihre Vorschau selbst ab und
verbrauchten den Einmal-Link, bevor jemand tippte — so ist der erste
Backoffice-Zugang gescheitert. `scripts/anmeldelink.mjs` baut die Links
entsprechend.

Die Kopfzeile zeigt „Backoffice" nur Team-Mitgliedern und prüft das im
Browser: Sie hängt auch an statisch vorgerenderten Seiten, eine
Serverprüfung machte die alle dynamisch.

### Zwei Fallen, die hier zugeschnappt sind

**Eine Funktion lässt sich nicht an eine Client-Komponente reichen.**
`<VipTabelle formatiere={(iso) => …}>` brach die ganze VIP-Seite ab
("Functions cannot be passed directly to Client Components"). Formatiert
wird jetzt auf dem Server, hinübergereicht wird Text.

**Werte aus einem `"use client"`-Modul kommen in einer
Server-Komponente nicht an.** Sie bekommt statt des Wertes einen
Platzhalter, über den React später die Komponente findet.
`{ ...LEERE_PHASE }` ergab so ein Objekt ohne `leistungen`, und „Event
anlegen" brach beim Zeichnen ab — während „Event bearbeiten" lief, weil
dessen Phasen aus der Datenbank kommen. Solche geteilten Werte gehören
in eine Datei **ohne** `"use client"`: `src/lib/event-stand.ts`.

## Umgebungsvariablen

**Beide Namen für den öffentlichen Supabase-Schlüssel werden akzeptiert**
(`PUBLISHABLE_KEY` und der ältere `ANON_KEY`) — siehe
`src/lib/supabase/umgebung.ts`. Das ist kein Schlendrian, sondern die
Lehre aus einem echten Ausfall.

**`NEXT_PUBLIC_`-Werte werden beim Bauen eingesetzt, nicht beim
Ausführen.** Wer sie in Vercel nachträgt, muss neu ausliefern.

## Was noch nicht existiert — und wo das sichtbar wird

Zwei Dinge werden dem Gast auf der Bestätigungsseite **nicht** versprochen,
solange sie nicht eingerichtet sind, weil das sonst eine Lüge wäre:

- **Mailversand** (`RESEND_API_KEY`). Ohne ihn steht dort ausdrücklich,
  dass diese Seite gerade die einzige Stelle mit den Tickets ist.
- **Wallet-Pässe** (`APPLE_WALLET_TEAM_ID` / `GOOGLE_WALLET_ISSUER_ID`).
  Ohne sie verschwindet der Wallet-Hinweis.

Genauso der **Testkauf**: `schliesseTestkaufAb()` schließt eine Bestellung
ohne Zahlung ab (Zahlungsart `frei`) und **verweigert den Dienst**, sobald
`STRIPE_SECRET_KEY` oder `PAYPAL_CLIENT_SECRET` gesetzt sind. Der Weg
verschwindet also von selbst, wenn echtes Geld fließen kann — er muss
nicht zurückgebaut werden.

Dieses Muster bitte beibehalten: Wer eine Zusage macht, prüft vorher, ob
sie eingelöst werden kann.

## Stand

Fertig und geprüft:

- Design-Tokens, Logo-Varianten, i18n-Gerüst
- Startseite, Eventliste mit Filter, Eventdetail mit Ticketauswahl
- Checkout in vier Schritten mit **Stripe** (Testschlüssel), Bestätigung
  mit digitalen Tickets (QR serverseitig als SVG)
- Konto und „Meine Tickets" per Anmeldelink; Gastkäufe werden über die
  bestätigte E-Mail zugeordnet (Trigger in 0004)
- VIP-Anfrageformular mit Honigfalle statt Captcha
- Einlass-Scanner, offline-fähig
- Backoffice: Kennzahlen, Event-Editor mit Bild-Upload, Bestellungen,
  VIP-Anfragen
- About, Kontakt, FAQ, AGB, Datenschutz, Impressum, eigene 404- und
  Fehlerseite
- Sitemap, robots, Vorschaubilder für geteilte Links
- Abgelaufene Reservierungen werden alle fünf Minuten freigegeben (pg_cron)

Offen:

1. **Zugangsdaten nachtragen**: PayPal, Resend, Apple- und
   Google-Wallet. Alles dafür ist gebaut; ohne Schlüssel bleibt es
   stumm, und die Oberfläche verspricht nichts davon.
2. **Mailversand** (`RESEND_API_KEY`). Ohne ihn sagt die
   Bestätigungsseite ausdrücklich, dass die Seite die einzige Stelle mit
   den Tickets ist — und niemand erfährt von neuen VIP-Anfragen außer
   durchs Backoffice.
4. **Echte Eventfotos.** Der Upload steht, die Bilder fehlen. Laut
   Briefing tragen sie die halbe Gestaltung.
5. **Firmendaten** für Impressum, AGB und Datenschutz — die Lücken sind
   in den Seiten sichtbar markiert. Rechtstexte müssen anwaltlich geprüft
   werden.
6. **Newsletter-Bestätigung** (Double Opt-in). Das Formular steht,
   verschickt wird bis dahin nichts.
8. Stripe-Konto freischalten lassen. Ticketverkauf gilt als erhöhtes
   Risiko; mit Sicherheitseinbehalt und verzögerter Auszahlung rechnen.

Alle Seiten rendern **dynamisch**, weil sie Restkontingente anzeigen.
Für Startseite und Eventliste wäre ein kurzes `revalidate` denkbar; das
Eventdetail sollte dynamisch bleiben, sonst zeigt es veraltete
Restmengen.
