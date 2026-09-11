from PIL import Image

src = Image.open("assets/logo/lunar-outline.png").convert("RGBA")
alpha = src.getchannel("A")
alpha = alpha.crop(alpha.getbbox())
print("zugeschnitten", alpha.size)

GOLD=(198,161,91); IVORY=(248,247,243); NAVY=(11,23,40)

def bau(farbe, name, anteil=None, breite=1200):
    al = alpha
    if anteil:
        w, h = al.size
        al = al.crop((0, 0, w, int(h*anteil)))
        al = al.crop(al.getbbox())
    w, h = al.size
    im = Image.new("RGBA", (w, h), farbe + (0,))
    im.putalpha(al)
    im = im.resize((breite, max(1, round(h * breite / w))), Image.LANCZOS)
    im.save(f"assets/logo/{name}.png", optimize=True)
    print(name, im.size)

bau(GOLD, "lunar-gold-flat"); bau(IVORY, "lunar-ivory"); bau(NAVY, "lunar-navy")
bau(GOLD, "mark-gold", 0.62, 512); bau(IVORY, "mark-ivory", 0.62, 512)
