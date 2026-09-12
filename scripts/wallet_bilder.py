"""
Erzeugt die Bilder, die ein Apple-Wallet-Pass braucht.

    python scripts/wallet_bilder.py

Apple verlangt feste Groessen und feste Dateinamen, jeweils in drei
Aufloesungen. Fehlt eine, weigert sich Wallet den Pass zu oeffnen — ohne
zu sagen, welche.

  icon   29x29    Symbol in Meldungen und auf dem Sperrbildschirm
  logo   160x50   oben links im Pass
  strip  375x98   Streifen ueber dem Text (nur eventTicket)

Das Symbol bekommt einen Navy-Grund: Auf dem Sperrbildschirm steht es
sonst auf Weiss, und ein weisses Logo auf Weiss ist unsichtbar.
"""
import io
import os
from PIL import Image

QUELLE = "assets/logo"
ZIEL = "assets/wallet"

NAVY = (7, 17, 31, 255)


def lade(name: str) -> Image.Image:
    return Image.open(os.path.join(QUELLE, name)).convert("RGBA")


def auf_flaeche(logo: Image.Image, breite: int, hoehe: int,
                grund=None, anteil: float = 0.78) -> Image.Image:
    """Logo mittig auf eine Flaeche setzen, ohne es zu verzerren."""
    flaeche = Image.new("RGBA", (breite, hoehe), grund or (0, 0, 0, 0))

    max_b = int(breite * anteil)
    max_h = int(hoehe * anteil)
    kopie = logo.copy()
    kopie.thumbnail((max_b, max_h), Image.LANCZOS)

    flaeche.paste(
        kopie,
        ((breite - kopie.width) // 2, (hoehe - kopie.height) // 2),
        kopie,
    )
    return flaeche


def schreibe(bild: Image.Image, name: str) -> None:
    pfad = os.path.join(ZIEL, name)
    bild.save(pfad, "PNG", optimize=True)
    print(f"  {name:22} {bild.width}x{bild.height}")


def main() -> None:
    os.makedirs(ZIEL, exist_ok=True)

    marke = lade("mark-ivory.png")   # nur Mond und Sterne
    voll = lade("lunar-ivory.png")   # Lockup mit Schriftzug

    print("Symbol (auf Navy, damit es auf hellem Grund sichtbar bleibt):")
    for faktor, endung in ((1, ""), (2, "@2x"), (3, "@3x")):
        kante = 29 * faktor
        schreibe(auf_flaeche(marke, kante, kante, NAVY, 0.68), f"icon{endung}.png")

    print("Logo (transparent, Wallet setzt es auf den Passgrund):")
    for faktor, endung in ((1, ""), (2, "@2x"), (3, "@3x")):
        schreibe(
            auf_flaeche(voll, 160 * faktor, 50 * faktor, None, 0.92),
            f"logo{endung}.png",
        )

    print("Streifen (Navy mit Goldschimmer, wie der Hero):")
    for faktor, endung in ((1, ""), (2, "@2x"), (3, "@3x")):
        b, h = 375 * faktor, 98 * faktor
        streifen = Image.new("RGBA", (b, h), NAVY)

        # Weicher Goldschein oben rechts — dieselbe Handschrift wie auf
        # der Website, nur in klein.
        schein = Image.new("RGBA", (b, h), (0, 0, 0, 0))
        px = schein.load()
        mx, my = b * 0.78, h * 0.1
        radius = max(b, h) * 0.75
        for y in range(h):
            for x in range(0, b, 2):  # jede zweite Spalte genügt, dann spiegeln
                d = ((x - mx) ** 2 + (y - my) ** 2) ** 0.5
                if d < radius:
                    staerke = int(52 * (1 - d / radius) ** 2)
                    px[x, y] = (198, 161, 91, staerke)
                    if x + 1 < b:
                        px[x + 1, y] = (198, 161, 91, staerke)
        streifen = Image.alpha_composite(streifen, schein)

        marke_klein = marke.copy()
        marke_klein.thumbnail((int(h * 0.62), int(h * 0.62)), Image.LANCZOS)
        streifen.paste(
            marke_klein,
            (int(b * 0.06), (h - marke_klein.height) // 2),
            marke_klein,
        )
        schreibe(streifen, f"strip{endung}.png")

    print(f"\nFertig in {ZIEL}/")


if __name__ == "__main__":
    main()
