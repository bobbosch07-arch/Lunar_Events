# Markenbriefing Lunar Events

Verdichtete Fassung des Kundenbriefings vom 11.09.2026. Bei
gestalterischen Fragen gilt dieses Dokument vor allen anderen
Überlegungen. Was hier steht, ist entschieden — nicht Vorschlag.

## Marke

Premium-Nightlife, Clubs und gehobene Partys. Zielgruppe 18–30, Interesse
an Nightlife, hochwertigen Locations, VIP, Exklusivität, sozialem Status.

Die Seite soll sagen: *„Hier gehst du hin, wenn die Nacht zählen soll."*

**Lunar darf sich nicht anfühlen wie:** ein generischer Ticketmarktplatz,
ein billiger Partyveranstalter, eine Gaming-Marke, eine Festival-Vorlage,
ein futuristisches Tech-Startup, eine grelle Vegas-Luxusmarke oder eine
düstere Underground-Techno-Marke.

**Sondern:** exklusiv, selbstbewusst, kultiviert, modern, klar, wählerisch,
atmosphärisch, jung ohne kindisch.

Ticketing ist notwendig, soll sich aber wie eine hochwertige Buchung
anfühlen, nicht wie ein Onlineshop.

Luxus entsteht aus Abständen, Typografie, Proportion, Fotografie,
sparsamer Farbe, präziser Ausrichtung, feinen Goldakzenten und guten
Bildern — **nicht** aus Verläufen, Leuchten, Schatten und Animationen.

## Farben

Ivory + Midnight Navy + Champagne Gold. Die Werte stehen als Tokens in
`src/styles/tokens.css` und sind dort die einzige Quelle.

Hell ist die Voreinstellung. Dunkle Navy-Abschnitte setzen bewusst
Kontraste. **Kein reines Schwarz als Grundfarbe.**

### Gold

Gold ist Akzent, nicht die beherrschende Farbe. Erlaubt für: feine
Trenner, ausgewählte Zustände, dezente Ränder, Premium- und
VIP-Kennzeichnung, Details an wichtigen Handlungsaufforderungen,
Hover-Zustände.

Vermeiden: große goldene Flächen, goldene Hintergründe ohne zwingenden
Grund, dauerhaftes Leuchten, metallisch wirkende Verläufe.

> Gold soll sich anfühlen wie Schmuck: selten, präzise, wertvoll.

## Typografie

Aus drei Lookboards ausgewählt: **Richtung 03 „Contemporary Nightlife"**,
Syne für Display, DM Sans für Text und Bedienoberfläche. Beide SIL Open
Font License.

Großzügige Sperrung für Versal-Labels, Navigation, Kategorien und
VIP-Kennzeichnungen. Keine übertriebene Sperrung im Fließtext. Große
Überschriften eng geführt, Fließtext luftig.

## Layout

Großzügig. Große Ränder, kräftige Abstände zwischen Abschnitten, klare
Ausrichtung, einheitliches Raster, zurückhaltende Dichte.

Die Oberfläche darf **nicht** wie ein Dashboard wirken. Die Startseite
soll näher an gehobener Hotellerie und Mode liegen als an Ticketmaster.

## Fotografie

Eines der wichtigsten Markenelemente. Gewünscht: hochwertige Clubs,
kultivierte Nightlife-Momente, stimmungsvolle Räume, elegantes Publikum,
DJs, Architektur, Premium-Tische, Bottle Service, Stadt bei Nacht,
filmisches Licht, geschmackvolle Mode, ungestellte gesellige Momente.

Vermeiden: billige Party-Stockfotos, Neon-Überfluss, kitschige
Clubflyer-Optik, sexualisierte Darstellungen, generische
Festivalmengen, Handyfotos in schlechter Auflösung, Cyberpunk.

Bilder sollen erstrebenswert wirken, aber glaubwürdig bleiben.

## Seitenaufbau

**Startseite:** Hero mit viel Freiraum (Headline im Stil „YOUR NIGHT.
ELEVATED.", Haupt-CTA „Events entdecken", zweitrangig „Mehr erfahren") →
2–4 ausgewählte Events in großen Karten → Eventübersicht mit dezenten
Filtern → VIP-Abschnitt → Markenabschnitt → schlanke Fußzeile.

**Event-Karte:** Bild zuerst, Datum, Titel, Ort, Startpreis, Kategorie,
optional VIP-Verfügbarkeit, ein CTA. Nicht überladen. Radius 6–10 px,
feine Ränder, zurückhaltende Schatten. Kein Glassmorphism, keine
Neon-Ränder, keine riesigen Rundungen.

**Eventdetail:** Hero mit Bild, Name, Datum, Ort → Informationen (Datum,
Beginn, Ort, Mindestalter, Dresscode, Veranstalter) → Ticketauswahl nach
Phasen (Early Bird, Phase 2, Standard, Last Chance, VIP auf Anfrage).

Jede Phase zeigt Name, Preis, Verfügbarkeit, enthaltene Leistungen und —
wenn sinnvoll — die Restmenge. **Ausverkaufte Phasen werden nicht
versteckt.** Das schafft Transparenz und echte Dringlichkeit.

**Abendkasse** wird, wenn vorhanden, deutlich ausgewiesen und klar von
der Online-Verfügbarkeit unterschieden. Online-Verfügbarkeit darf niemals
als Zusage für die Abendkasse erscheinen.

**Checkout:** sehr aufgeräumt, vier Schritte (Ticket, Daten, Zahlung,
Bestätigung), keine überflüssige Navigation, keine Werbung. Deutlicher
Gesamtpreis, Gebühren, Zustimmung zu den Bedingungen, sichtbar sichere
Zahlung.

**Bestätigung:** kräftig und hochwertig, kein generischer Zahlungsbeleg.

**VIP** ist grundlegend anders als ein Ticketkauf. Nicht „VIP-Ticket
99 €", sondern eine Anfrage: Tisch, Bottle Service, mehrere Gäste,
bevorzugte Platzierung, exklusiver Zugang, individuelle Wünsche. Das
Formular erfasst Name, E-Mail, Telefon, Event, Gästezahl, Wunschdatum,
Paket und Nachricht.

## Bewegung

Zurückhaltend und filmisch. 150–250 ms für Mikro-Interaktionen, dezente
Bildvergrößerung beim Hover, sanfte Ein- und Übergänge.

Vermeiden: Federn und Hüpfen, ausgeprägtes Parallax, rotierende Elemente,
harte Seitenübergänge, Dauerbewegung, Leuchten.

> Bewegung soll die Oberfläche teuer wirken lassen, nie wie eine
> Animationsvorführung.

## Barrierefreiheit

Kontraste nach WCAG, Tastaturbedienung, sichtbarer Fokus, semantisches
HTML, beschriftete Formularfelder, Alternativtexte, ausreichend große
Tap-Ziele.

**Gold darf nie das einzige Merkmal eines Zustands sein.** „Ausgewählt"
wird nicht allein durch Goldfarbe mitgeteilt.

## Verkaufspsychologie

Der Gast darf nie im Unklaren sein, was er kauft: Name, Preis, Menge,
enthaltene Leistungen, Verfügbarkeit, Gebühren, Endsumme.

Dringlichkeit entsteht **nur aus wahrheitsgemäßer Verfügbarkeit**. Keine
erfundene Knappheit, keine Countdown-Uhren überall, kein „nur noch 2
übrig", keine Pop-ups, keine Rabattschlacht.

> Gewünschte Reaktion: „Da will ich hin." Nicht: „Ich muss kaufen, bevor
> das Pop-up verschwindet."

## Sprache und Texte

Kurz, selbstbewusst, hochwertig, modern, direkt. Kein Behördendeutsch,
keine Floskeln wie „ein unvergessliches Erlebnis". Marketingzeilen dürfen
gezielt englisch sein („THE NIGHT STARTS HERE.").

Oberflächensprache ist **Deutsch**, Englisch wird unterstützt. Keine
Zeichenkette gehört fest in eine Komponente.

## Backoffice

Getrennt von der Kundenoberfläche und **nicht** an die Markenoptik
gebunden. Dort zählen Bedienbarkeit, Datendichte, Klarheit, Filter und
Auswertungen.

Zu erfassen: Seitenaufrufe, Eventaufrufe, Ticketauswahl, begonnene und
abgeschlossene Checkouts, Abbrüche, Tickettyp, Umsatz, Konversionsrate,
Eventleistung, VIP-Anfragen, Herkunft und Kampagnenzuordnung — unter
Beachtung der Einwilligungspflichten.

## Grundregel

Im Zweifel: **weniger**. Was Hierarchie, Bedienbarkeit, Marke oder
Atmosphäre nicht verbessert, kommt raus.

> Die Seite soll teuer aussehen, weil sie beherrscht ist — nicht weil sie
> viele teuer aussehende Effekte enthält.
