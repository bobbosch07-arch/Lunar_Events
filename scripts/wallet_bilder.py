"""
Erzeugt die Bilder, die ein Apple-Wallet-Pass braucht.

    python scripts/wallet_bilder.py

Apple verlangt feste Groessen und feste Dateinamen, jeweils in drei
Aufloesungen. Fehlt eine, weigert sich Wallet den Pass zu oeffnen — ohne
zu sagen, welche.

  icon   29x29    Symbol in Meldungen und auf dem Sperrbildschirm
  logo   160x50   oben links im Pass
  strip  375x98   Streifen ueber dem Text (nur eventTicket)

Violett-Nacht (30.09.2026): Quelle ist das farbige Logo (gelbe Sichel,
rosa Sterne). Das Symbol bekommt einen Nacht-Grund: Auf dem
Sperrbildschirm steht es sonst auf Weiss. Der Streifen ist der violette
Himmel mit der Sichel rechts — links liegt der Eventname darueber, dort
bleibt es ruhig. Geschrieben wird nach assets/wallet und public/wallet
(von dort liest der Pass).
"""
import io
import os
from PIL import Image

QUELLE = "public/logo"
ZIELE = ["assets/wallet", "public/wallet"]

NACHT = (34, 10, 79, 255)


def lade(name: str) -> Image.Image:
    return Image.open(os.path.join(QUELLE, name)).convert("RGBA")


def auf_flaeche(logo: Image.Image, breite: int, hoehe: int,
                grund=None, anteil: float = 0.78, links: bool = False) -> Image.Image:
    """Logo mittig auf eine Flaeche setzen, ohne es zu verzerren."""
    flaeche = Image.new("RGBA", (breite, hoehe), grund or (0, 0, 0, 0))

    max_b = int(breite * anteil)
    max_h = int(hoehe * anteil)
    kopie = logo.copy()
    kopie.thumbnail((max_b, max_h), Image.LANCZOS)

    flaeche.paste(
        kopie,
        (0 if links else (breite - kopie.width) // 2, (hoehe - kopie.height) // 2),
        kopie,
    )
    return flaeche


def schreibe(bild: Image.Image, name: str) -> None:
    for ziel in ZIELE:
        bild.save(os.path.join(ziel, name), "PNG", optimize=True)
    print(f"  {name:22} {bild.width}x{bild.height}")


def verlauf(breite: int, hoehe: int) -> Image.Image:
    """Der violette Himmel: von Violett oben links zur Nacht unten rechts."""
    oben, mitte, unten = (138, 77, 255), (91, 33, 201), (34, 10, 79)
    bild = Image.new("RGBA", (breite, hoehe))
    px = bild.load()
    for y in range(hoehe):
        for x in range(breite):
            t = min(1.0, (0.55 * x / breite) + (0.45 * y / hoehe) * 1.4)
            if t < 0.45:
                a, b, f = oben, mitte, t / 0.45
            else:
                a, b, f = mitte, unten, (t - 0.45) / 0.55
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * f) for i in range(3)) + (255,)
    return bild


def main() -> None:
    for ziel in ZIELE:
        os.makedirs(ziel, exist_ok=True)

    marke = lade("mark-farbig.png")   # gelbe Sichel mit rosa Sternen
    voll = lade("lunar-farbig.png")   # Lockup mit Schriftzug

    print("Symbol (auf Nacht, damit es auf hellem Grund sichtbar bleibt):")
    for faktor, endung in ((1, ""), (2, "@2x"), (3, "@3x")):
        kante = 29 * faktor
        schreibe(auf_flaeche(marke, kante, kante, NACHT, 0.74), f"icon{endung}.png")

    print("Logo (transparent, Wallet setzt es auf den Passgrund):")
    for faktor, endung in ((1, ""), (2, "@2x"), (3, "@3x")):
        schreibe(
            # Links buendig: Apple setzt die Flaeche oben links in den Pass,
            # mittig wirkte das Logo eingerueckt.
            auf_flaeche(voll, 160 * faktor, 50 * faktor, None, 0.94, links=True),
            f"logo{endung}.png",
        )

    print("Streifen (violetter Himmel, Sichel rechts angeschnitten):")
    for faktor, endung in ((1, ""), (2, "@2x"), (3, "@3x")):
        b, h = 375 * faktor, 98 * faktor
        streifen = verlauf(b, h)
        gross = marke.copy()
        hoehe = int(h * 1.5)
        gross = gross.resize((int(gross.width * hoehe / gross.height), hoehe), Image.LANCZOS)
        streifen.alpha_composite(gross, (b - int(gross.width * 0.82), -int(hoehe * 0.2)))
        schreibe(streifen, f"strip{endung}.png")

    print(f"\nFertig in {', '.join(ZIELE)}/")


if __name__ == "__main__":
    main()
