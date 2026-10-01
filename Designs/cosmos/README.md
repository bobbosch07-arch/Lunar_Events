# Lunar Events: Cosmos-Deko-Assets

Dekorative SVGs im Stil „Violett-Nacht“. Farben: Violett #5B21C9, Nacht #220A4F, Mondgelb #FFE14A, Rosa #FF8FD6, Lila-Weiß #F7F0FF.
Alle SVGs haben einen transparenten Hintergrund und sind für den Nacht-Grund (#220A4F) gemacht.

Die Dateien liegen in `/public/cosmos/` (oder im entsprechenden Static-Ordner), `lunar-cosmos.css` einmal global einbinden.

## Dateien
| Datei | Größe | Zweck |
|---|---|---|
| stardust-tile.svg | 480², kachelbar | Sternenstaub als Hintergrund für Sektionen (`.cosmos-bg`) |
| stardust-tile-dense.svg | 480², kachelbar | dichtere Variante (`.cosmos-bg--dense`) |
| divider-cosmos.svg | 1200×240 | Füller für Lücken zwischen Sektionen, z. B. zwischen Event-Karte und VIP-Block |
| sparkle-yellow/pink/white.svg | 1:1 | einzelnes ✦ Funkeln, frei skalierbar |
| sparkle-cluster.svg | 1:1 | 3er-Funkel-Gruppe für Ecken |
| planet-ringed.svg | 1:1 | gelber Ringplanet |
| planet-pink.svg | 1:1 | rosa Planet mit Kratern + Mond auf Orbit |
| planet-violet.svg | 1:1 | kleiner violetter Planet |
| moon-sickle.svg | 1:1 | Mondsichel (Logo-Motiv) |
| black-hole.svg | 1:1 | schwarzes Loch mit Akkretionsscheibe |
| comet.svg | 1:1 | Sternschnuppe |
| orbit-ring.svg | 1:1 | gestrichelter Orbit mit 2 Monden |

## Einbau

**1. Lücke zwischen Sektionen füllen**
```html
<img src="/cosmos/divider-cosmos.svg" class="cosmos-divider" alt="" aria-hidden="true">
```

**2. Hintergrund mit Sternenstaub** (gesamte Seite oder einzelne Sektion)
```html
<body class="cosmos-bg">
```

**3. Einzelne Widgets hinter/neben Karten** (Eltern-Element braucht `.cosmos-host`)
```html
<section class="cosmos-host">
  <img src="/cosmos/black-hole.svg" class="cosmos-deco cosmos-float cosmos-deco--hide-mobile"
       style="width:180px; left:-120px; top:40px" alt="" aria-hidden="true">
  <img src="/cosmos/sparkle-yellow.svg" class="cosmos-deco cosmos-twinkle"
       style="width:28px; right:-40px; top:-20px" alt="" aria-hidden="true">
  …Inhalt…
</section>
```

## Regeln
- Sparsam einsetzen: pro Viewport höchstens 1 großes Widget (Planet, schwarzes Loch) und 3–5 Sparkles.
- Deko nie über Text legen, immer `z-index:-1` innerhalb von `.cosmos-host`.
- Die großen Widgets (`--hide-mobile`) auf dem Handy ausblenden, die Sparkles dürfen bleiben.
- `prefers-reduced-motion` ist in der CSS schon berücksichtigt.
