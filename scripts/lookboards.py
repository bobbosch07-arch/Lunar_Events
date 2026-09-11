# -*- coding: utf-8 -*-
"""Erzeugt docs/lookboards.html — drei Typografie-Richtungen, gleiche Bausteine."""
import io, os

RICHTUNGEN = [
    dict(
        key="a", nr="01", name="Modern Luxury",
        display="Jost", body="Manrope",
        charakter="Architektonisch · geometrisch · ruhig",
        begruendung="Jost steht in der Futura-Tradition: reine Kreise, gleichmäßige Strichstärke, keine Mode-Attitüde. "
                    "Das ist die Schrift von Architekturbüros und Hotelgruppen — teuer wirkt sie durch Proportion, nicht durch Dekor. "
                    "Manrope trägt darunter die Fließtexte, etwas wärmer und im Kleinen gut lesbar.",
        headline_weight="500", headline_track="0.16em", h_track="0.06em",
        nav_track="0.18em", radius="6px", hero_size="clamp(2.1rem, 5.4vw, 4.1rem)",
        risiko="Am sichersten von den dreien — und am austauschbarsten, wenn die Fotos nicht liefern.",
    ),
    dict(
        key="b", nr="02", name="Editorial Luxury",
        display="Bodoni Moda", body="Work Sans",
        charakter="Fashion · redaktionell · hochwertig",
        begruendung="Bodoni ist die Schrift der Modemagazine: extremer Strichkontrast, hohe Serifen, aristokratisch. "
                    "Sie macht aus einem Eventnamen eine Titelseite. Work Sans daneben bleibt bewusst nüchtern — "
                    "der Kontrast zwischen beiden ist die eigentliche Gestaltung.",
        headline_weight="400", headline_track="0.01em", h_track="0.02em",
        nav_track="0.2em", radius="4px", hero_size="clamp(2.4rem, 6.4vw, 5rem)",
        risiko="Stärkster Charakter, engste Führung: Bodoni bricht bei kleinen Graden und schlechten Fotos sofort zusammen.",
    ),
    dict(
        key="c", nr="03", name="Contemporary Nightlife",
        display="Syne", body="DM Sans",
        charakter="Jung · kantig · energisch",
        begruendung="Syne kommt aus dem Kultur- und Clubumfeld: ungleiche Buchstabenbreiten, harte Schnitte, "
                    "ein Rhythmus, der nach Plakat und Line-up klingt. Premium, aber mit Puls. "
                    "DM Sans hält den Funktionsteil — Preise, Formulare, Checkout — ruhig und unauffällig.",
        headline_weight="700", headline_track="0.005em", h_track="0.04em",
        nav_track="0.16em", radius="8px", hero_size="clamp(2.2rem, 5.8vw, 4.4rem)",
        risiko="Am nächsten an ‚Clubflyer‘. Trägt das Branding, verträgt aber keine zweite laute Entscheidung daneben.",
    ),
]

FONT_LINK = (
    "https://fonts.googleapis.com/css2?"
    "family=Jost:wght@300;400;500;600&"
    "family=Manrope:wght@300;400;500;600;700&"
    "family=Bodoni+Moda:opsz,wght@6..96,400;6..96,500;6..96,600&"
    "family=Work+Sans:wght@300;400;500;600&"
    "family=Syne:wght@400;500;600;700;800&"
    "family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&"
    "display=swap"
)


def qr(groesse="112px"):
    muster = "1101011010110101011010110101101011010110" * 2
    zellen = "".join(
        '<i class="an"></i>' if muster[(i * 7 + 3) % len(muster)] == "1" else "<i></i>"
        for i in range(64)
    )
    return (
        '<div class="qr" style="--qr:%s" role="img" aria-label="Platzhalter für den Ticket-Code">'
        '<div class="qr-raster">%s</div>'
        '<span class="qr-eck e1"></span><span class="qr-eck e2"></span><span class="qr-eck e3"></span>'
        "</div>" % (groesse, zellen)
    )


def karte(datum, titel, ort, preis, kategorie, vip, nr):
    vipmark = '<span class="k-vip">VIP frei</span>' if vip else ""
    return """<article class="karte">
      <div class="k-bild k-bild-%d" aria-hidden="true"><span class="k-datum">%s</span>%s</div>
      <div class="k-text">
        <span class="k-kat">%s</span>
        <h4 class="k-titel">%s</h4>
        <p class="k-ort">%s</p>
        <div class="k-fuss"><span class="k-preis preis-t">%s</span><span class="k-cta">Event ansehen</span></div>
      </div>
    </article>""" % (nr, datum, vipmark, kategorie, titel, ort, preis)


def phase(name, preis, hinweis, aus=False, gewaehlt=False, vip=False):
    kl = "phk" + (" aus" if aus else "") + (" gewaehlt" if gewaehlt else "") + (" vip" if vip else "")
    if aus:
        rechts = '<span class="phk-aus">Ausverkauft</span>'
    else:
        stil = "gold" if vip else ("primaer" if gewaehlt else "linie")
        txt = "Anfragen" if vip else ("Gewählt" if gewaehlt else "Auswählen")
        rechts = '<button class="btn btn-%s btn-klein">%s</button>' % (stil, txt)
    hw = '<span class="phk-hinweis">%s</span>' % hinweis if hinweis else ""
    return """<div class="%s">
      <div class="phk-l"><span class="phk-name">%s</span>%s</div>
      <div class="phk-r"><span class="phk-preis preis-t">%s</span>%s</div>
    </div>""" % (kl, name, hw, preis, rechts)


def board(r):
    return """
<section class="board" id="board-{key}" data-dir="{key}">
  <header class="board-kopf">
    <div class="bk-nr">Lookboard {nr}</div>
    <h2 class="bk-name">{name}</h2>
    <p class="bk-char">{charakter}</p>
    <dl class="bk-fonts">
      <div><dt>Display</dt><dd class="probe-display">{display}</dd></div>
      <div><dt>Text &amp; UI</dt><dd class="probe-body">{body}</dd></div>
      <div><dt>Lizenz</dt><dd class="probe-body">SIL Open Font License</dd></div>
    </dl>
    <p class="bk-text">{begruendung}</p>
    <p class="bk-risiko"><span>Das Risiko</span>{risiko}</p>
  </header>

  <div class="feld">
    <div class="feld-titel">Typografie</div>
    <div class="skala">
      <div class="sk-zeile"><span class="sk-rolle">Display</span><span class="display-xl">LUNAR NIGHT</span></div>
      <div class="sk-zeile"><span class="sk-rolle">H1</span><span class="display-l">Moonrise Rooftop</span></div>
      <div class="sk-zeile"><span class="sk-rolle">H3</span><span class="display-m">Tickets &amp; Phasen</span></div>
      <div class="sk-zeile"><span class="sk-rolle">Body</span><span class="body-t">Einlass ab 22:00 Uhr. Ab 21 Jahren, Lichtbildausweis erforderlich. Dresscode: elegant, keine Sportkleidung.</span></div>
      <div class="sk-zeile"><span class="sk-rolle">Label</span><span class="label-t">VIP &middot; FRANKFURT &middot; AUSVERKAUFT</span></div>
      <div class="sk-zeile"><span class="sk-rolle">Preis</span><span class="preis-t">39 &euro;</span></div>
    </div>
  </div>

  <div class="feld">
    <div class="feld-titel">Navigation</div>
    <nav class="nav">
      <img class="nav-logo" src="logo/lunar-navy.png" alt="Lunar Events" />
      <div class="nav-mitte"><a class="aktiv">Events</a><a>About</a><a>Kontakt</a></div>
      <div class="nav-rechts"><a>Meine Tickets</a><a>Account</a></div>
    </nav>
  </div>

  <div class="feld">
    <div class="feld-titel">Homepage &middot; Hero</div>
    <div class="hero">
      <div class="hero-bild" aria-hidden="true"><span class="bildnotiz">Bildfläche</span></div>
      <div class="hero-inhalt">
        <img class="hero-logo" src="logo/lunar-ivory.png" alt="Lunar Events" />
        <h1 class="hero-titel">YOUR NIGHT.<br/>ELEVATED.</h1>
        <p class="hero-sub">Ausgewählte Nächte in Frankfurt, Mannheim und Stuttgart.</p>
        <div class="hero-cta">
          <button class="btn btn-hell">Events entdecken</button>
          <button class="btn btn-linie-hell">Mehr erfahren</button>
        </div>
      </div>
    </div>
  </div>

  <div class="feld">
    <div class="feld-titel">Event-Karten</div>
    <div class="karten">{karten}</div>
  </div>

  <div class="feld">
    <div class="feld-titel">Event-Detail &middot; Ticketauswahl</div>
    <div class="phasen">{phasen}</div>
    <div class="abendkasse">
      <div><span class="ak-rolle">Online</span><strong class="preis-t">39 &euro;</strong></div>
      <div class="ak-trenn" aria-hidden="true"></div>
      <div><span class="ak-rolle">Abendkasse</span><strong class="ak-hinweis">Preis kann abweichen</strong></div>
      <p class="ak-fuss">Online gekaufte Tickets garantieren den Einlass. Für die Abendkasse gilt das nicht.</p>
    </div>
  </div>

  <div class="feld">
    <div class="feld-titel">Digitales Ticket</div>
    <div class="ticket-reihe">
      <div class="ticket">
        <div class="t-kopf"><img src="logo/lunar-ivory.png" alt="Lunar Events" class="t-logo" /><span class="t-typ">Phase 2</span></div>
        <div class="t-body">
          <h4 class="t-event">LUNAR NIGHT 03</h4>
          <div class="t-daten">
            <div><span>Datum</span><strong>24. Okt 2026 &middot; 23:00</strong></div>
            <div><span>Ort</span><strong>Alte Werft, Frankfurt</strong></div>
            <div><span>Gast</span><strong>N. Schulz</strong></div>
            <div><span>Bestellung</span><strong class="tab">LUN-4471-09</strong></div>
          </div>
        </div>
        <div class="t-fuss">{qr1}<p class="t-hinweis">Am Einlass scannen lassen.<br/>Helligkeit hochdrehen.</p></div>
      </div>
      <div class="ticket ticket-vip">
        <div class="t-kopf"><img src="logo/lunar-ivory.png" alt="Lunar Events" class="t-logo" /><span class="t-typ t-typ-vip">VIP &middot; Tisch 04</span></div>
        <div class="t-body">
          <h4 class="t-event">MOONRISE</h4>
          <div class="t-daten">
            <div><span>Datum</span><strong>07. Nov 2026 &middot; 22:00</strong></div>
            <div><span>Ort</span><strong>Rooftop 12, Mannheim</strong></div>
            <div><span>Gäste</span><strong>6 Personen</strong></div>
            <div><span>Bestellung</span><strong class="tab">LUN-4512-01</strong></div>
          </div>
        </div>
        <div class="t-fuss">{qr2}<p class="t-hinweis">Priority Entry, linker Eingang.<br/>Gastgeberin: Melike K.</p></div>
      </div>
    </div>
  </div>

  <div class="feld">
    <div class="feld-titel">VIP-Sektion</div>
    <div class="vip">
      <div class="vip-links">
        <span class="vip-eyebrow">VIP Experience</span>
        <h3 class="vip-titel">PRIVATE. PREMIUM. PERSONAL.</h3>
        <p class="vip-text">VIP ist kein teureres Ticket. Es ist ein Tisch, ein Ansprechpartner und ein Abend, der vorher abgesprochen wurde.</p>
        <button class="btn btn-gold">VIP anfragen</button>
      </div>
      <ul class="vip-liste">
        <li>Eigener Tisch mit reservierter Fläche</li>
        <li>Bottle Service am Platz</li>
        <li>Priority Entry ohne Anstehen</li>
        <li>Persönliche Absprache vorab</li>
      </ul>
    </div>
  </div>

  <div class="feld">
    <div class="feld-titel">Buttons &amp; Zustände</div>
    <div class="btn-reihe">
      <button class="btn btn-primaer">Tickets kaufen</button>
      <button class="btn btn-linie">Mehr erfahren</button>
      <button class="btn btn-gold">VIP anfragen</button>
      <button class="btn btn-primaer" disabled>Ausverkauft</button>
    </div>
  </div>

  <div class="feld">
    <div class="feld-titel">Mobil</div>
    <div class="mobil-reihe">
      <div class="phone">
        <div class="ph-bar"><img src="logo/lunar-ivory.png" alt="Lunar Events" /><span class="ph-menu" aria-hidden="true"><i></i><i></i></span></div>
        <div class="ph-hero">
          <span class="bildnotiz">Bildfläche</span>
          <div class="ph-hero-txt">
            <span class="ph-datum">24 OKT 2026</span>
            <h5>LUNAR NIGHT 03</h5>
            <span class="ph-ort">Frankfurt &middot; Alte Werft</span>
          </div>
        </div>
        <div class="ph-body">
          <div class="ph-zeile"><span>Early Bird</span><b class="aus">Ausverkauft</b></div>
          <div class="ph-zeile ph-aktiv"><span>Phase 2</span><b>39 &euro;</b></div>
          <div class="ph-zeile"><span>Standard</span><b>49 &euro;</b></div>
        </div>
        <div class="ph-fuss"><span>2 Tickets &middot; 78 &euro;</span><button class="btn btn-primaer">Weiter</button></div>
      </div>
      <div class="phone phone-ticket">
        <div class="ph-bar"><img src="logo/lunar-ivory.png" alt="Lunar Events" /><span class="ph-titel-klein">Meine Tickets</span></div>
        <div class="ph-ticket">
          <span class="ph-typ">Phase 2</span>
          <h5>LUNAR NIGHT 03</h5>
          <span class="ph-ort">24. Okt &middot; 23:00 &middot; Frankfurt</span>
          {qr3}
          <span class="ph-nr tab">LUN-4471-09</span>
        </div>
      </div>
    </div>
  </div>
</section>""".format(
        key=r["key"], nr=r["nr"], name=r["name"], charakter=r["charakter"],
        display=r["display"], body=r["body"], begruendung=r["begruendung"], risiko=r["risiko"],
        karten=(karte("24 OKT", "LUNAR NIGHT 03", "Frankfurt · Alte Werft", "ab 29 €", "Club", True, 1)
                + karte("07 NOV", "MOONRISE", "Mannheim · Rooftop 12", "ab 35 €", "Rooftop", False, 2)
                + karte("21 NOV", "ECLIPSE", "Stuttgart · Halle Nord", "ab 25 €", "Party", False, 3)),
        phasen=(phase("Early Bird", "29 €", "", aus=True)
                + phase("Phase 2", "39 €", "Noch 24 verfügbar", gewaehlt=True)
                + phase("Standard", "49 €", "Verfügbar")
                + phase("VIP Experience", "auf Anfrage", "Tisch, Service, Priority Entry", vip=True)),
        qr1=qr("104px"), qr2=qr("104px"), qr3=qr("140px"),
    )


def css_dir(r):
    return """
.board[data-dir="%s"] {
  --font-display: "%s", Georgia, "Times New Roman", serif;
  --font-body: "%s", "Segoe UI", system-ui, sans-serif;
  --w-display: %s;
  --track-display: %s;
  --track-h: %s;
  --track-nav: %s;
  --radius: %s;
  --hero-size: %s;
}""" % (r["key"], r["display"], r["body"], r["headline_weight"], r["headline_track"],
        r["h_track"], r["nav_track"], r["radius"], r["hero_size"])


CSS = """
:root {
  color-scheme: light;
  --ivory-50:#FCFBF8; --ivory-100:#F7F5F0; --ivory-200:#EEEAE1;
  --navy-950:#07111F; --navy-900:#0B1728; --navy-800:#102238; --navy-700:#172E48;
  --gold-500:#C6A15B; --gold-400:#D4B873; --gold-300:#E4CE98; --gold-200:#EFE0B8;
  --text-1:#101418; --text-2:#5E6268; --text-3:#858990;
  --on-dark:#F8F7F3; --on-dark-2:#B9BEC6;
  --border-light:#E4E0D7; --border-dark:rgba(255,255,255,.14); --border-gold:rgba(198,161,91,.55);
  --shadow-card:0 8px 30px rgba(7,17,31,.08);
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px; --s6:24px; --s8:32px;
  --s10:40px; --s12:48px; --s16:64px; --s20:80px; --s24:96px;
  --font-display:"Jost",sans-serif; --font-body:"Manrope",sans-serif;
  --w-display:500; --track-display:.14em; --track-h:.05em; --track-nav:.18em;
  --radius:6px; --hero-size:3rem;
}
* { box-sizing:border-box; }
body { margin:0; background:var(--navy-950); color:var(--text-1);
  font-family:var(--font-body); -webkit-font-smoothing:antialiased; }
img { display:block; max-width:100%; }
button { font:inherit; cursor:pointer; }
h1,h2,h3,h4,h5 { margin:0; text-wrap:balance; }
p { margin:0; }
a { color:inherit; text-decoration:none; }
.tab { font-variant-numeric:tabular-nums; }
:focus-visible { outline:2px solid var(--gold-400); outline-offset:3px; }

.seite-kopf { background:var(--navy-950); color:var(--on-dark);
  padding:var(--s20) var(--s8) var(--s16);
  display:flex; flex-direction:column; align-items:center; gap:var(--s5);
  text-align:center; border-bottom:1px solid var(--border-dark); }
.seite-kopf img { width:min(280px,60vw); margin-bottom:var(--s4); }
.sk-eyebrow { font-size:.66rem; letter-spacing:.3em; text-transform:uppercase; color:var(--gold-400); }
.seite-kopf h1 { font-family:"Jost",sans-serif; font-weight:400; font-size:clamp(1.4rem,3.4vw,2.1rem);
  letter-spacing:.1em; text-transform:uppercase; color:var(--on-dark); }
.seite-kopf p { max-width:62ch; color:var(--on-dark-2); font-size:.95rem; line-height:1.75; }
.sprung { display:flex; flex-wrap:wrap; gap:var(--s2); justify-content:center; margin-top:var(--s3); }
.sprung a { border:1px solid var(--border-dark); border-radius:4px; padding:11px 18px;
  font-size:.72rem; letter-spacing:.14em; text-transform:uppercase; color:var(--on-dark-2);
  transition:border-color .2s, color .2s; }
.sprung a:hover { color:var(--gold-300); border-color:var(--border-gold); }

.board { background:var(--ivory-50); padding:var(--s20) clamp(20px,4vw,64px) var(--s24);
  display:flex; flex-direction:column; gap:var(--s16); }
.board + .board { border-top:6px solid var(--navy-950); }
.board-kopf { max-width:78ch; display:flex; flex-direction:column; gap:var(--s3); }
.bk-nr { font-size:.66rem; letter-spacing:.3em; text-transform:uppercase; color:var(--gold-500); }
.bk-name { font-family:var(--font-display); font-weight:var(--w-display);
  font-size:clamp(1.9rem,4.6vw,3.1rem); letter-spacing:var(--track-h); line-height:1.05; }
.bk-char { font-size:.78rem; letter-spacing:.16em; text-transform:uppercase; color:var(--text-3); }
.bk-fonts { display:flex; flex-wrap:wrap; gap:var(--s8); margin:var(--s3) 0 var(--s2); }
.bk-fonts div { display:flex; flex-direction:column; gap:3px; }
.bk-fonts dt { font-size:.64rem; letter-spacing:.18em; text-transform:uppercase; color:var(--text-3); }
.bk-fonts dd { margin:0; font-size:.95rem; color:var(--text-1); }
.probe-display { font-family:var(--font-display); font-weight:var(--w-display); font-size:1.3rem; }
.probe-body { font-family:var(--font-body); }
.bk-text { color:var(--text-2); line-height:1.75; font-size:.95rem; max-width:66ch; }
.bk-risiko { font-size:.9rem; line-height:1.7; color:var(--text-2);
  border-left:2px solid var(--border-gold); padding-left:var(--s4); max-width:66ch; }
.bk-risiko span { display:block; font-size:.64rem; letter-spacing:.2em; text-transform:uppercase;
  color:var(--gold-500); margin-bottom:3px; }

.feld { display:flex; flex-direction:column; gap:var(--s5); }
.feld-titel { font-size:.64rem; letter-spacing:.24em; text-transform:uppercase; color:var(--text-3);
  padding-bottom:var(--s3); border-bottom:1px solid var(--border-light); }

.skala { display:flex; flex-direction:column; gap:var(--s5); }
.sk-zeile { display:grid; grid-template-columns:84px 1fr; gap:var(--s5); align-items:baseline; }
.sk-rolle { font-size:.62rem; letter-spacing:.18em; text-transform:uppercase; color:var(--text-3); }
.display-xl { font-family:var(--font-display); font-weight:var(--w-display);
  font-size:clamp(2rem,5.6vw,3.6rem); letter-spacing:var(--track-display); line-height:1.02; text-transform:uppercase; }
.display-l { font-family:var(--font-display); font-weight:var(--w-display);
  font-size:clamp(1.4rem,3.2vw,2.1rem); letter-spacing:var(--track-h); line-height:1.15; }
.display-m { font-family:var(--font-display); font-weight:var(--w-display);
  font-size:1.25rem; letter-spacing:var(--track-h); }
.body-t { font-size:1rem; line-height:1.75; color:var(--text-2); max-width:60ch; }
.label-t { font-size:.72rem; letter-spacing:.22em; text-transform:uppercase; color:var(--gold-500); }
.preis-t { font-family:var(--font-display); font-weight:var(--w-display); font-size:1.35rem;
  letter-spacing:.02em; font-variant-numeric:tabular-nums; }

.nav { display:flex; align-items:center; gap:var(--s8); background:var(--ivory-50);
  border:1px solid var(--border-light); border-radius:var(--radius); padding:var(--s5) var(--s6); }
.nav-logo { height:30px; width:auto; }
.nav-mitte { display:flex; gap:var(--s6); }
.nav-rechts { display:flex; gap:var(--s6); margin-left:auto; }
.nav a { font-size:.72rem; letter-spacing:var(--track-nav); text-transform:uppercase; color:var(--text-2);
  padding-bottom:4px; border-bottom:1px solid transparent; transition:color .2s, border-color .2s; }
.nav a:hover { color:var(--gold-500); }
.nav a.aktiv { color:var(--text-1); border-bottom-color:var(--gold-500); }

.hero { position:relative; border-radius:var(--radius); overflow:hidden; min-height:440px;
  display:flex; align-items:flex-end; background:var(--navy-900); }
.hero-bild { position:absolute; inset:0;
  background:
    radial-gradient(120% 90% at 72% 18%, rgba(198,161,91,.28), transparent 58%),
    radial-gradient(90% 70% at 18% 82%, rgba(23,46,72,.95), transparent 60%),
    linear-gradient(168deg,#12263E 0%,#0B1728 46%,#07111F 100%); }
.bildnotiz { position:absolute; top:var(--s4); right:var(--s4); font-size:.58rem; letter-spacing:.2em;
  text-transform:uppercase; color:rgba(255,255,255,.34); border:1px solid rgba(255,255,255,.16);
  border-radius:3px; padding:4px 8px; z-index:2; }
.hero-inhalt { position:relative; padding:var(--s16) clamp(24px,4vw,48px);
  display:flex; flex-direction:column; gap:var(--s5); align-items:flex-start; width:100%;
  background:linear-gradient(0deg, rgba(7,17,31,.86) 12%, rgba(7,17,31,0) 100%); }
.hero-logo { width:160px; opacity:.95; margin-bottom:var(--s2); }
.hero-titel { font-family:var(--font-display); font-weight:var(--w-display); color:var(--on-dark);
  font-size:var(--hero-size); letter-spacing:var(--track-display); line-height:1.02; }
.hero-sub { color:var(--on-dark-2); font-size:1rem; line-height:1.7; max-width:46ch; }
.hero-cta { display:flex; flex-wrap:wrap; gap:var(--s3); margin-top:var(--s2); }

.btn { border-radius:var(--radius); padding:14px 26px; font-family:var(--font-body); font-weight:600;
  font-size:.74rem; letter-spacing:.14em; text-transform:uppercase; border:1px solid transparent;
  transition:background-color .2s ease, color .2s ease, border-color .2s ease; min-height:46px; }
.btn-primaer { background:var(--navy-900); color:var(--ivory-50); }
.btn-primaer:hover { background:var(--navy-700); }
.btn-primaer[disabled] { background:var(--ivory-200); color:var(--text-3); cursor:not-allowed; }
.btn-linie { background:transparent; color:var(--navy-900); border-color:var(--navy-900); }
.btn-linie:hover { background:var(--navy-900); color:var(--ivory-50); }
.btn-gold { background:transparent; color:var(--navy-900); border-color:var(--border-gold); }
.btn-gold:hover { background:var(--gold-500); border-color:var(--gold-500); color:var(--navy-950); }
.btn-hell { background:var(--ivory-50); color:var(--navy-950); }
.btn-hell:hover { background:var(--gold-300); }
.btn-linie-hell { background:transparent; color:var(--on-dark); border-color:rgba(255,255,255,.4); }
.btn-linie-hell:hover { border-color:var(--gold-400); color:var(--gold-300); }
.btn-klein { padding:10px 18px; min-height:40px; font-size:.68rem; }
.btn-reihe { display:flex; flex-wrap:wrap; gap:var(--s3); }

.karten { display:grid; grid-template-columns:repeat(auto-fit,minmax(268px,1fr)); gap:var(--s6); }
.karte { background:var(--ivory-50); border:1px solid var(--border-light); border-radius:var(--radius);
  overflow:hidden; box-shadow:var(--shadow-card); display:flex; flex-direction:column; }
.k-bild { position:relative; aspect-ratio:4/3; }
.k-bild-1 { background:linear-gradient(158deg,#16304C,#0B1728 62%,#07111F); }
.k-bild-2 { background:linear-gradient(158deg,#1D3350,#122438 58%,#07111F); }
.k-bild-3 { background:linear-gradient(158deg,#0F2138,#16293E 55%,#07111F); }
.k-bild::after { content:""; position:absolute; inset:0;
  background:radial-gradient(80% 60% at 70% 22%, rgba(198,161,91,.22), transparent 62%); }
.k-datum { position:absolute; left:var(--s4); bottom:var(--s4); z-index:1; color:var(--on-dark);
  font-family:var(--font-display); font-weight:var(--w-display); font-size:.85rem; letter-spacing:.22em; }
.k-vip { position:absolute; right:var(--s4); top:var(--s4); z-index:1; font-size:.58rem; letter-spacing:.18em;
  text-transform:uppercase; color:var(--gold-300); border:1px solid var(--border-gold);
  border-radius:3px; padding:4px 8px; }
.k-text { padding:var(--s5) var(--s5) var(--s6); display:flex; flex-direction:column; gap:var(--s2); flex:1; }
.k-kat { font-size:.6rem; letter-spacing:.2em; text-transform:uppercase; color:var(--text-3); }
.k-titel { font-family:var(--font-display); font-weight:var(--w-display); font-size:1.3rem;
  letter-spacing:var(--track-h); text-transform:uppercase; }
.k-ort { color:var(--text-2); font-size:.9rem; }
.k-fuss { margin-top:auto; padding-top:var(--s5); display:flex; align-items:baseline;
  justify-content:space-between; gap:var(--s3); border-top:1px solid var(--border-light); }
.k-preis { font-size:1.05rem; }
.k-cta { font-size:.66rem; letter-spacing:.16em; text-transform:uppercase; color:var(--text-2);
  border-bottom:1px solid var(--border-gold); padding-bottom:2px; }

.phasen { display:flex; flex-direction:column; gap:var(--s3); max-width:760px; }
.phk { display:flex; align-items:center; justify-content:space-between; gap:var(--s5);
  border:1px solid var(--border-light); border-radius:var(--radius); padding:var(--s5) var(--s6);
  background:var(--ivory-50); }
.phk.gewaehlt { border-color:var(--navy-900); box-shadow:inset 3px 0 0 var(--gold-500); background:var(--ivory-100); }
.phk.aus { background:var(--ivory-100); border-style:dashed; }
.phk.aus .phk-name, .phk.aus .phk-preis { color:var(--text-3); text-decoration:line-through; }
.phk.vip { border-color:var(--border-gold); background:linear-gradient(100deg,var(--ivory-100),var(--ivory-50)); }
.phk-l { display:flex; flex-direction:column; gap:3px; }
.phk-name { font-family:var(--font-display); font-weight:var(--w-display); font-size:1rem;
  letter-spacing:.14em; text-transform:uppercase; }
.phk-hinweis { font-size:.78rem; color:var(--text-2); }
.phk-r { display:flex; align-items:center; gap:var(--s5); }
.phk-preis { font-size:1.15rem; }
.phk-aus { font-size:.66rem; letter-spacing:.2em; text-transform:uppercase; color:var(--text-3); }
.abendkasse { display:flex; flex-wrap:wrap; align-items:center; gap:var(--s8); max-width:760px;
  border:1px solid var(--border-light); border-radius:var(--radius); padding:var(--s5) var(--s6);
  background:var(--ivory-100); }
.abendkasse > div { display:flex; flex-direction:column; gap:3px; }
.ak-rolle { font-size:.6rem; letter-spacing:.2em; text-transform:uppercase; color:var(--text-3); }
.ak-hinweis { font-size:.92rem; font-weight:500; color:var(--text-2); }
.ak-trenn { width:1px; align-self:stretch; background:var(--border-light); }
.ak-fuss { flex-basis:100%; font-size:.8rem; color:var(--text-3); line-height:1.6; }

.ticket-reihe { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:var(--s6); max-width:820px; }
.ticket { background:var(--navy-900); color:var(--on-dark); border-radius:var(--radius);
  border:1px solid var(--border-dark); overflow:hidden; display:flex; flex-direction:column; }
.ticket-vip { border-color:var(--border-gold); }
.t-kopf { display:flex; align-items:center; justify-content:space-between; gap:var(--s4);
  padding:var(--s5); border-bottom:1px solid var(--border-dark); }
.t-logo { height:22px; width:auto; }
.t-typ { font-size:.6rem; letter-spacing:.2em; text-transform:uppercase; color:var(--on-dark-2);
  border:1px solid var(--border-dark); border-radius:3px; padding:4px 9px; white-space:nowrap; }
.t-typ-vip { color:var(--gold-300); border-color:var(--border-gold); }
.t-body { padding:var(--s6) var(--s5) var(--s5); display:flex; flex-direction:column; gap:var(--s5); }
.t-event { font-family:var(--font-display); font-weight:var(--w-display); font-size:1.5rem;
  letter-spacing:var(--track-h); text-transform:uppercase; }
.t-daten { display:grid; grid-template-columns:1fr 1fr; gap:var(--s4) var(--s5); }
.t-daten div { display:flex; flex-direction:column; gap:2px; }
.t-daten span { font-size:.58rem; letter-spacing:.18em; text-transform:uppercase; color:var(--on-dark-2); }
.t-daten strong { font-size:.88rem; font-weight:500; }
.t-fuss { margin-top:auto; display:flex; align-items:center; gap:var(--s5);
  padding:var(--s5); border-top:1px dashed var(--border-dark); }
.t-hinweis { font-size:.76rem; line-height:1.6; color:var(--on-dark-2); }

.qr { position:relative; width:var(--qr); height:var(--qr); background:var(--ivory-50);
  border-radius:3px; padding:7px; flex:none; }
.qr-raster { display:grid; grid-template-columns:repeat(8,1fr); grid-auto-rows:1fr; gap:2px;
  width:100%; height:100%; }
.qr-raster i { background:transparent; border-radius:1px; }
.qr-raster i.an { background:var(--navy-950); }
.qr-eck { position:absolute; width:23%; height:23%; border:3px solid var(--navy-950); border-radius:2px; }
.qr-eck.e1 { top:7px; left:7px; }
.qr-eck.e2 { top:7px; right:7px; }
.qr-eck.e3 { bottom:7px; left:7px; }

.vip { display:grid; grid-template-columns:1.15fr .85fr; gap:var(--s12); align-items:center;
  background:var(--ivory-100); border:1px solid var(--border-light); border-radius:var(--radius);
  padding:clamp(24px,3vw,48px); }
.vip-links { display:flex; flex-direction:column; gap:var(--s4); align-items:flex-start; }
.vip-eyebrow { font-size:.62rem; letter-spacing:.28em; text-transform:uppercase; color:var(--gold-500); }
.vip-titel { font-family:var(--font-display); font-weight:var(--w-display);
  font-size:clamp(1.5rem,3.4vw,2.3rem); letter-spacing:var(--track-h); line-height:1.1; }
.vip-text { color:var(--text-2); line-height:1.75; max-width:44ch; font-size:.95rem; }
.vip-liste { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.vip-liste li { padding:var(--s4) 0; border-top:1px solid var(--border-light); font-size:.92rem; }
.vip-liste li:last-child { border-bottom:1px solid var(--border-light); }

.mobil-reihe { display:flex; flex-wrap:wrap; gap:var(--s8); }
.phone { width:320px; border:1px solid var(--border-light); border-radius:20px; overflow:hidden;
  background:var(--ivory-50); box-shadow:var(--shadow-card); display:flex; flex-direction:column; }
.ph-bar { display:flex; align-items:center; justify-content:space-between; padding:var(--s4) var(--s5);
  background:var(--navy-950); }
.ph-bar img { height:18px; width:auto; }
.ph-menu { display:flex; flex-direction:column; gap:4px; }
.ph-menu i { display:block; width:20px; height:1px; background:var(--on-dark-2); }
.ph-titel-klein { font-size:.6rem; letter-spacing:.2em; text-transform:uppercase; color:var(--on-dark-2); }
.ph-hero { position:relative; height:190px; display:flex; align-items:flex-end;
  background:linear-gradient(162deg,#16304C,#0B1728 58%,#07111F); }
.ph-hero::after { content:""; position:absolute; inset:0;
  background:radial-gradient(90% 70% at 68% 20%, rgba(198,161,91,.24), transparent 60%); }
.ph-hero-txt { position:relative; z-index:1; padding:var(--s5); display:flex; flex-direction:column;
  gap:3px; background:linear-gradient(0deg, rgba(7,17,31,.9), transparent); width:100%; }
.ph-datum { font-size:.6rem; letter-spacing:.22em; color:var(--gold-300); }
.ph-hero-txt h5 { font-family:var(--font-display); font-weight:var(--w-display); font-size:1.25rem;
  letter-spacing:var(--track-h); color:var(--on-dark); text-transform:uppercase; }
.ph-ort { font-size:.76rem; color:var(--on-dark-2); }
.ph-body { padding:var(--s2) var(--s5); display:flex; flex-direction:column; }
.ph-zeile { display:flex; align-items:center; justify-content:space-between; gap:var(--s4);
  padding:var(--s4) 0; border-bottom:1px solid var(--border-light); font-size:.9rem; }
.ph-zeile b { font-family:var(--font-display); font-weight:var(--w-display); font-variant-numeric:tabular-nums; }
.ph-zeile b.aus { font-family:var(--font-body); font-size:.68rem; letter-spacing:.16em;
  text-transform:uppercase; color:var(--text-3); font-weight:500; }
.ph-zeile.ph-aktiv { box-shadow:inset 2px 0 0 var(--gold-500); margin-left:-12px; padding-left:12px; }
.ph-fuss { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:var(--s4);
  padding:var(--s4) var(--s5); border-top:1px solid var(--border-light); background:var(--ivory-100); font-size:.8rem; }
.ph-fuss .btn { padding:12px 20px; min-height:42px; }
.ph-ticket { background:var(--navy-900); color:var(--on-dark); padding:var(--s6) var(--s5) var(--s8);
  display:flex; flex-direction:column; align-items:center; gap:var(--s2); text-align:center; flex:1; }
.ph-typ { font-size:.6rem; letter-spacing:.2em; text-transform:uppercase; color:var(--gold-300); }
.ph-ticket h5 { font-family:var(--font-display); font-weight:var(--w-display); font-size:1.25rem;
  letter-spacing:var(--track-h); text-transform:uppercase; }
.ph-ticket .qr { margin:var(--s5) 0 var(--s3); }
.ph-nr { font-size:.72rem; letter-spacing:.16em; color:var(--on-dark-2); }

.seite-fuss { background:var(--navy-950); color:var(--on-dark-2); padding:var(--s16) var(--s8) var(--s20);
  display:flex; flex-direction:column; align-items:center; gap:var(--s4); text-align:center; }
.seite-fuss h2 { font-family:"Jost",sans-serif; font-weight:400; color:var(--on-dark);
  font-size:1.3rem; letter-spacing:.14em; text-transform:uppercase; }
.seite-fuss p { max-width:58ch; font-size:.92rem; line-height:1.75; }
.fuss-schritte { display:flex; flex-wrap:wrap; gap:var(--s2); justify-content:center; margin-top:var(--s3); }
.fuss-schritte span { border:1px solid var(--border-dark); border-radius:4px; padding:10px 16px;
  font-size:.7rem; letter-spacing:.14em; text-transform:uppercase; }
.fuss-klein { font-size:.8rem; color:#6E7683; margin-top:var(--s6); }

@media (max-width:860px) {
  .vip { grid-template-columns:1fr; gap:var(--s8); }
  .nav { flex-wrap:wrap; gap:var(--s4); }
  .nav-rechts { margin-left:0; }
  .t-daten { grid-template-columns:1fr; }
  .sk-zeile { grid-template-columns:1fr; gap:var(--s1); }
  .phone { width:100%; max-width:340px; }
  .phk { flex-wrap:wrap; }
}
@media (prefers-reduced-motion:reduce) { * { transition:none !important; animation:none !important; } }
"""

HTML = """<title>Lunar Lookboards</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="{fonts}" />
<style>{css}{dirs}</style>

<header class="seite-kopf">
  <img src="logo/lunar-ivory.png" alt="Lunar Events" />
  <span class="sk-eyebrow">Schritt 1 vor der Umsetzung</span>
  <h1>Drei Richtungen zur Auswahl</h1>
  <p>Farben, Abstände und Geometrie sind in allen drei Boards identisch — sie stehen im Briefing fest.
     Unterschiedlich ist nur die Typografie, und damit der Charakter der Marke. Dieselben neun Bausteine
     in derselben Reihenfolge, damit der Vergleich ehrlich bleibt. Eine Richtung auswählen, dann wird sie
     festgeschrieben und alles Weitere darauf gebaut.</p>
  <nav class="sprung">
    <a href="#board-a">01 &middot; Modern Luxury</a>
    <a href="#board-b">02 &middot; Editorial Luxury</a>
    <a href="#board-c">03 &middot; Contemporary Nightlife</a>
  </nav>
</header>
{boards}
<footer class="seite-fuss">
  <h2>Nach der Entscheidung</h2>
  <p>Die gewählte Richtung wird zu Design-Tokens: Schriftskala, Farben, Abstände, Radien, Schatten,
     Bewegung. Danach entsteht das Komponentensystem, und erst darauf die Seiten. Kein Bauteil bekommt
     eigene Farben oder eigene Schriftgrade.</p>
  <div class="fuss-schritte">
    <span>1 &middot; Typografie festschreiben</span><span>2 &middot; Tokens</span><span>3 &middot; Komponenten</span>
    <span>4 &middot; Seiten</span><span>5 &middot; Checkout</span><span>6 &middot; App</span>
  </div>
  <p class="fuss-klein">Bildflächen sind Platzhalter — echte Eventfotos ersetzen sie.
     Die Codefelder auf den Tickets sind Attrappen.</p>
</footer>
""".format(
    fonts=FONT_LINK,
    css=CSS,
    dirs="".join(css_dir(r) for r in RICHTUNGEN),
    boards="".join(board(r) for r in RICHTUNGEN),
)

os.makedirs("docs", exist_ok=True)
# Sonderzeichen als HTML-Entities: die Seite bleibt korrekt, auch wenn sie
# ohne charset-Header ausgeliefert wird.
with io.open("docs/lookboards.html", "w", encoding="ascii", errors="xmlcharrefreplace") as f:
    f.write(HTML)
print("geschrieben: docs/lookboards.html,", len(HTML), "zeichen")
