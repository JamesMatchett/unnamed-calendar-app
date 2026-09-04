"""
Generate the bundled cover art.

The covers are drawn rather than photographed, deliberately: fixtures that ship
with the repository must not carry a stock-photo licence, and an illustration
can never be mistaken for a real photograph of a real place. What changed is
what they illustrate. The first pass was abstract gradient checks, which read as
"image failed to load" more than as a cover; these are flat scenes of the thing
each calendar is actually about, so a person scanning a list recognises the trip
before reading its name.

Run:  python3 tools/covers.py
Out:  src/apps/mobile/assets/covers/*.png  (1200x600, the aspect the card uses)
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 600
OUT = Path(__file__).resolve().parents[1] / "src/apps/mobile/assets/covers"


# --- helpers ---------------------------------------------------------------


def blend(a: tuple[int, int, int], b: tuple[int, int, int], t: float):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sky(top: tuple[int, int, int], bottom: tuple[int, int, int], height: int = H):
    """A vertical wash. Every scene starts as light, so this is the base layer."""
    img = Image.new("RGB", (W, height))
    d = ImageDraw.Draw(img)
    for y in range(height):
        d.line([(0, y), (W, y)], fill=blend(top, bottom, y / max(1, height - 1)))
    return img


def glow(img, xy, radius, colour, strength=0.55):
    """A soft light: sun, floodlight, stage lamp. Drawn as a blurred disc."""
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [xy[0] - radius, xy[1] - radius, xy[0] + radius, xy[1] + radius], fill=colour
    )
    layer = layer.filter(ImageFilter.GaussianBlur(radius * 0.55))
    return _screen(img, layer, strength)


def _screen(base, layer, strength):
    b = base.load()
    l = layer.load()
    out = base.copy()
    o = out.load()
    for y in range(H):
        for x in range(W):
            br, bg, bb = b[x, y]
            lr, lg, lb = l[x, y]
            o[x, y] = (
                min(255, br + round(lr * strength)),
                min(255, bg + round(lg * strength)),
                min(255, bb + round(lb * strength)),
            )
    return out


def grain(img, amount=5, seed=1):
    """A little noise, so large flat areas do not band on a phone screen."""
    rng = random.Random(seed)
    px = img.load()
    for y in range(H):
        for x in range(W):
            n = rng.randint(-amount, amount)
            r, g, b = px[x, y]
            px[x, y] = (
                max(0, min(255, r + n)),
                max(0, min(255, g + n)),
                max(0, min(255, b + n)),
            )
    return img


def finish(img, name, seed=1):
    # A touch of grain stops large flat washes banding on a phone, then a
    # palette: these are flat scenes of a few dozen colours, so quantising costs
    # nothing visible and roughly halves what ships in the bundle.
    img = grain(img, 3, seed)
    img = img.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    img.save(OUT / f"{name}.png", optimize=True)
    print("wrote", name)


def hills(d, base_y, colour, seed, amplitude=40, step=60):
    rng = random.Random(seed)
    pts = [(-20, base_y)]
    x = -20
    while x < W + 40:
        pts.append((x, base_y + rng.randint(-amplitude, amplitude)))
        x += step
    pts += [(W + 40, base_y), (W + 40, H + 10), (-20, H + 10)]
    d.polygon(pts, fill=colour)


# --- scenes ----------------------------------------------------------------


def lisbon():
    """Rooftops running down to the Tagus, late afternoon."""
    img = sky((250, 190, 132), (250, 226, 190))
    img = glow(img, (250, 210), 160, (255, 216, 150), 0.5)
    d = ImageDraw.Draw(img)

    # River first, high up, so the town can sit in front of it.
    d.rectangle([0, 250, W, 340], fill=(178, 176, 190))
    for y in range(256, 340, 9):
        d.line([(0, y), (W, y)], fill=(190, 188, 200))
    # The far bank, a low haze on the horizon.
    d.rectangle([0, 240, W, 254], fill=(206, 184, 176))

    # The bridge: the one shape that says which river this is.
    for x in (820, 1080):
        d.line([(x, 300), (x, 176)], fill=(184, 104, 92), width=7)
        d.line([(x - 22, 300), (x + 22, 300)], fill=(184, 104, 92), width=6)
    d.line([(700, 226), (820, 190), (1080, 190), (1190, 226)], fill=(184, 104, 92), width=5)
    d.line([(700, 232), (1190, 232)], fill=(184, 104, 92), width=5)
    for x in range(720, 1190, 34):
        d.line([(x, 232), (x, 196 + abs(x - 950) * 0.09)], fill=(196, 126, 112), width=2)

    # The town, in three ranks down the hill. Pastel walls, terracotta roofs,
    # each rank lower, larger and warmer than the one behind it.
    rng = random.Random(7)
    walls = [(238, 226, 208), (236, 214, 190), (226, 222, 208), (240, 232, 216), (222, 208, 196)]
    ranks = [
        (300, 96, 0.42, (176, 96, 74)),
        (360, 128, 0.20, (190, 100, 74)),
        (432, 168, 0.00, (204, 108, 78)),
    ]
    for top, height, haze, roof in ranks:
        x = -50
        while x < W + 50:
            w = rng.randint(70, 128)
            y = top + rng.randint(-14, 14)
            wall = blend(rng.choice(walls), (198, 190, 196), haze)
            d.rectangle([x, y, x + w, y + height + 40], fill=wall)
            d.polygon(
                [(x - 9, y), (x + w + 9, y), (x + w - 8, y - 17), (x + 8, y - 17)],
                fill=blend(roof, (200, 190, 190), haze),
            )
            shade = blend(wall, (120, 96, 92), 0.22)
            d.rectangle([x + w - 14, y, x + w, y + height + 40], fill=shade)
            for wy in range(int(y + 26), int(y + height + 20), 46):
                for wx in range(int(x + 14), int(x + w - 26), 32):
                    d.rectangle([wx, wy, wx + 13, wy + 20],
                                fill=blend((118, 100, 104), (190, 184, 190), haze))
            x += w + rng.randint(2, 12)

    # A miradouro wall along the front, and a couple of trees on it.
    d.rectangle([0, 560, W, 600], fill=(214, 198, 178))
    for cx in (140, 470, 900):
        d.rectangle([cx - 7, 520, cx + 7, 564], fill=(122, 96, 74))
        d.ellipse([cx - 52, 462, cx + 52, 542], fill=(96, 130, 88))

    finish(img, "lisbon", 3)


def tram():
    """Number 28 coming up a narrow street."""
    img = sky((238, 224, 206), (250, 244, 236))
    d = ImageDraw.Draw(img)

    # Buildings either side, converging, which is what makes it a street.
    d.polygon([(0, 0), (330, 0), (300, 600), (0, 600)], fill=(226, 212, 196))
    d.polygon([(W, 0), (880, 0), (905, 600), (W, 600)], fill=(214, 198, 184))
    for y in range(70, 520, 110):
        d.rectangle([70, y, 150, y + 70], fill=(176, 158, 148))
        d.rectangle([200, y + 20, 268, y + 84], fill=(176, 158, 148))
        d.rectangle([1050, y, 1130, y + 70], fill=(166, 150, 142))
        d.rectangle([950, y + 20, 1010, y + 84], fill=(166, 150, 142))

    # Cobbles.
    d.polygon([(300, 600), (905, 600), (760, 330), (455, 330)], fill=(196, 188, 180))
    # Rails.
    d.line([(520, 330), (430, 600)], fill=(160, 150, 144), width=6)
    d.line([(690, 330), (770, 600)], fill=(160, 150, 144), width=6)
    # Overhead wire.
    d.line([(455, 120), (760, 120)], fill=(150, 140, 136), width=3)

    # The tram itself, yellow, square-shouldered, seen head on.
    d.rectangle([470, 250, 740, 520], fill=(238, 190, 60))
    d.rectangle([470, 250, 740, 268], fill=(214, 166, 46))
    d.rectangle([496, 286, 714, 400], fill=(126, 152, 158))   # windscreen
    d.rectangle([508, 296, 600, 392], fill=(150, 176, 180))
    d.rectangle([614, 296, 704, 392], fill=(150, 176, 180))
    d.rectangle([496, 424, 714, 470], fill=(246, 214, 120))   # panel
    d.ellipse([520, 470, 566, 512], fill=(70, 66, 64))
    d.ellipse([646, 470, 692, 512], fill=(70, 66, 64))
    d.line([(605, 250), (605, 126)], fill=(120, 112, 108), width=5)  # pole to the wire

    finish(img, "tram", 11)


def fado():
    """A small dark room, a guitar, one lamp."""
    img = sky((44, 28, 30), (26, 17, 20))
    img = glow(img, (600, 150), 220, (196, 120, 60), 0.42)
    d = ImageDraw.Draw(img)

    # Lamp above.
    d.line([(600, 0), (600, 96)], fill=(90, 70, 58), width=4)
    d.polygon([(548, 150), (652, 150), (626, 96), (574, 96)], fill=(214, 158, 92))

    # Player: shoulders, head, and the guitar's two bodies.
    d.ellipse([516, 300, 596, 380], fill=(30, 20, 22))
    d.polygon([(470, 600), (500, 400), (612, 400), (642, 600)], fill=(30, 20, 22))
    d.ellipse([614, 372, 742, 500], fill=(150, 96, 52))
    d.ellipse([672, 330, 776, 434], fill=(150, 96, 52))
    d.ellipse([690, 400, 726, 436], fill=(58, 36, 26))
    d.line([(760, 356), (900, 250)], fill=(120, 78, 44), width=13)
    d.polygon([(886, 262), (930, 228), (944, 246), (900, 280)], fill=(96, 62, 36))

    # Chairs waiting in the dark.
    for x in (170, 300, 940, 1060):
        d.rectangle([x, 470, x + 78, 486], fill=(40, 28, 30))
        d.rectangle([x + 6, 486, x + 18, 600], fill=(40, 28, 30))
        d.rectangle([x + 60, 486, x + 72, 600], fill=(40, 28, 30))
        d.rectangle([x, 380, x + 78, 470], fill=(36, 25, 27))

    finish(img, "fado", 5)


def beach():
    """Atlantic, mid-morning, one umbrella."""
    img = sky((122, 178, 214), (204, 226, 236))
    img = glow(img, (250, 120), 120, (255, 240, 200), 0.35)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 300, W, 430], fill=(58, 122, 146))
    for i, y in enumerate(range(310, 430, 16)):
        d.line([(0, y), (W, y)], fill=blend((78, 146, 168), (128, 186, 200), i / 8))
    # Surf.
    d.rectangle([0, 424, W, 446], fill=(232, 240, 240))
    d.rectangle([0, 440, W, 600], fill=(232, 214, 182))
    for y in range(456, 600, 26):
        d.line([(0, y), (W, y)], fill=(226, 206, 172))

    # Umbrella and two towels: enough to say "people are here" without figures.
    d.line([(880, 300), (880, 500)], fill=(120, 100, 88), width=6)
    d.pieslice([760, 214, 1000, 386], 180, 360, fill=(214, 92, 84))
    d.pieslice([760, 214, 1000, 386], 200, 240, fill=(240, 236, 228))
    d.pieslice([760, 214, 1000, 386], 280, 320, fill=(240, 236, 228))
    d.polygon([(770, 508), (930, 500), (940, 546), (778, 556)], fill=(236, 226, 210))
    d.polygon([(300, 520), (470, 512), (480, 560), (308, 570)], fill=(226, 160, 96))

    finish(img, "beach", 9)


def market():
    """Stalls under striped awnings."""
    img = sky((236, 222, 200), (246, 240, 228))
    d = ImageDraw.Draw(img)

    # The hall behind the stalls, so the top of the frame is a place rather
    # than empty sky. Tall windows, roof beams, and a floor to stand on.
    d.rectangle([0, 0, W, 120], fill=(222, 210, 192))
    for x in range(40, W, 150):
        d.rounded_rectangle([x, 22, x + 96, 118], 40, fill=(238, 232, 218))
    d.rectangle([0, 118, W, 132], fill=(198, 186, 170))
    d.rectangle([0, 430, W, 600], fill=(206, 194, 182))
    for x in range(0, W, 96):
        d.line([(x, 430), (x, 600)], fill=(198, 186, 176), width=2)

    rng = random.Random(4)
    colours = [(206, 90, 78), (74, 132, 128), (222, 172, 70), (120, 108, 158)]
    x = -30
    i = 0
    while x < W:
        w = rng.randint(200, 250)
        top = 168 + rng.randint(-14, 14)
        c = colours[i % len(colours)]
        # Awning: alternating stripes, scalloped along the bottom.
        for s in range(0, w, 34):
            d.polygon(
                [(x + s, top), (x + s + 34, top), (x + s + 34, top + 66), (x + s, top + 66)],
                fill=c if (s // 34) % 2 == 0 else (244, 238, 228),
            )
        for s in range(0, w, 34):
            d.pieslice([x + s, top + 44, x + s + 34, top + 88], 0, 180,
                       fill=c if (s // 34) % 2 == 0 else (244, 238, 228))
        # Posts and a table of produce.
        d.rectangle([x + 8, top + 66, x + 18, 470], fill=(150, 138, 128))
        d.rectangle([x + w - 20, top + 66, x + w - 10, 470], fill=(150, 138, 128))
        d.rectangle([x + 4, 400, x + w - 4, 432], fill=(178, 150, 118))
        for j in range(6):
            cx = x + 30 + j * ((w - 60) / 5)
            r = rng.randint(12, 20)
            d.ellipse([cx - r, 400 - r * 2, cx + r, 400], fill=rng.choice(
                [(214, 118, 70), (160, 176, 96), (226, 178, 74), (178, 88, 92)]
            ))
        x += w + 16
        i += 1

    finish(img, "market", 13)


def london():
    """The skyline at dusk, from the south bank."""
    img = sky((58, 66, 108), (196, 138, 132))
    img = glow(img, (300, 400), 200, (240, 160, 120), 0.35)
    d = ImageDraw.Draw(img)

    far = (72, 74, 108)
    near = (44, 46, 72)

    # Background blocks.
    rng = random.Random(21)
    x = 0
    while x < W:
        w = rng.randint(40, 90)
        h = rng.randint(60, 150)
        d.rectangle([x, 430 - h, x + w, 470], fill=far)
        x += w + rng.randint(6, 20)

    # Recognisable shapes, left to right: a dome, a clock tower, a gherkin, a shard.
    d.rectangle([180, 360, 300, 470], fill=near)
    d.pieslice([190, 280, 290, 380], 180, 360, fill=near)
    d.rectangle([236, 250, 246, 286], fill=near)

    d.rectangle([430, 250, 470, 470], fill=near)
    d.rectangle([424, 226, 476, 258], fill=near)
    d.polygon([(424, 226), (476, 226), (450, 186)], fill=near)

    d.polygon([(700, 470), (700, 330), (724, 286), (748, 330), (748, 470)], fill=near)

    d.polygon([(940, 470), (976, 200), (1012, 470)], fill=near)

    # River.
    d.rectangle([0, 470, W, 600], fill=(52, 56, 86))
    for y in range(482, 600, 18):
        d.line([(0, y), (W, y)], fill=(64, 68, 100))
    for x in (200, 240, 450, 720, 976):
        d.line([(x, 474), (x, 560)], fill=(150, 132, 140), width=3)

    finish(img, "london", 17)


def gig():
    """A stage, from somewhere in the crowd."""
    img = sky((22, 18, 34), (44, 26, 48))
    for xy, col in (((330, 90), (120, 60, 200)), ((870, 90), (220, 70, 120)), ((600, 60), (240, 190, 90))):
        img = glow(img, xy, 190, col, 0.5)
    d = ImageDraw.Draw(img)

    # Beams from the rig.
    for x0, x1, col in ((330, 120, (120, 80, 220)), (330, 620, (120, 80, 220)),
                        (870, 1080, (220, 90, 140)), (870, 580, (220, 90, 140))):
        d.polygon([(x0 - 14, 90), (x0 + 14, 90), (x1 + 120, 470), (x1 - 120, 470)],
                  fill=blend((30, 22, 40), col, 0.18))

    # Rig and stage.
    d.rectangle([120, 60, 1080, 78], fill=(24, 20, 30))
    for x in range(150, 1060, 90):
        d.ellipse([x, 78, x + 26, 100], fill=(60, 52, 70))
    d.rectangle([200, 300, 1000, 430], fill=(28, 22, 36))
    d.ellipse([560, 320, 640, 400], fill=(18, 14, 24))   # a figure at the mic
    d.polygon([(520, 430), (546, 356), (654, 356), (680, 430)], fill=(18, 14, 24))
    d.line([(600, 356), (600, 300)], fill=(18, 14, 24), width=5)

    # Crowd: overlapping heads and arms, darkest at the front.
    rng = random.Random(31)
    for row, (base, r, col) in enumerate([(500, 26, (26, 20, 34)), (556, 32, (16, 12, 22)), (610, 40, (10, 8, 16))]):
        x = -20
        while x < W + 40:
            d.ellipse([x, base - r, x + r * 2, base + r], fill=col)
            d.polygon([(x - r * 0.6, H), (x + r * 2.6, H), (x + r * 2, base), (x, base)], fill=col)
            if rng.random() < 0.3:
                d.line([(x + r, base - r), (x + r + rng.randint(-30, 30), base - r - 70)], fill=col, width=9)
            x += rng.randint(int(r * 1.4), int(r * 2.2))

    finish(img, "gig", 23)


def football():
    """Floodlights over a striped pitch."""
    img = sky((30, 44, 62), (60, 84, 96))
    for x in (180, 1020):
        img = glow(img, (x, 120), 130, (240, 240, 200), 0.45)
    d = ImageDraw.Draw(img)

    for x in (180, 1020):
        d.rectangle([x - 6, 120, x + 6, 330], fill=(38, 44, 56))
        d.rectangle([x - 58, 92, x + 58, 126], fill=(46, 52, 64))

    # Stand.
    d.rectangle([0, 300, W, 366], fill=(38, 46, 58))
    rng = random.Random(41)
    for y in range(308, 364, 14):
        for x in range(6, W, 13):
            if rng.random() < 0.75:
                d.rectangle([x, y, x + 8, y + 9], fill=rng.choice(
                    [(70, 82, 96), (86, 98, 112), (58, 68, 82)]
                ))

    # Pitch, mown in bands, brighter under the lights.
    d.rectangle([0, 366, W, 600], fill=(46, 118, 66))
    for i, y in enumerate(range(366, 600, 34)):
        if i % 2 == 0:
            d.rectangle([0, y, W, y + 34], fill=(54, 132, 74))
    d.rectangle([40, 400, 1160, 580], outline=(226, 236, 226), width=4)
    d.line([(600, 400), (600, 580)], fill=(226, 236, 226), width=4)
    d.ellipse([520, 452, 680, 528], outline=(226, 236, 226), width=4)
    d.rectangle([40, 448, 150, 532], outline=(226, 236, 226), width=4)
    d.rectangle([1050, 448, 1160, 532], outline=(226, 236, 226), width=4)

    finish(img, "football", 29)


def glastonbury():
    """Tents on a hillside, stage in the distance, sun going down."""
    img = sky((246, 178, 108), (250, 226, 176))
    img = glow(img, (600, 300), 170, (255, 208, 130), 0.5)
    d = ImageDraw.Draw(img)

    hills(d, 330, (196, 158, 110), 3, 26, 90)
    hills(d, 386, (150, 140, 88), 5, 22, 70)

    # The stage, a pyramid on the skyline.
    d.polygon([(520, 330), (600, 214), (680, 330)], fill=(120, 110, 80))
    d.line([(600, 214), (600, 186)], fill=(120, 110, 80), width=4)

    hills(d, 446, (104, 118, 70), 9, 18, 80)

    # Tents, smaller and paler further back.
    rng = random.Random(2)
    for base, scale, shade in ((470, 0.6, 0.45), (520, 0.85, 0.2), (580, 1.15, 0.0)):
        x = -40
        while x < W + 60:
            w = int(rng.randint(70, 110) * scale)
            h = int(rng.randint(46, 70) * scale)
            col = rng.choice([(206, 92, 82), (72, 116, 148), (226, 186, 92), (238, 236, 228), (108, 142, 96)])
            col = blend(col, (150, 156, 120), shade)
            d.polygon([(x, base), (x + w, base), (x + w / 2, base - h)], fill=col)
            d.polygon([(x + w * 0.34, base), (x + w * 0.5, base - h * 0.72), (x + w * 0.66, base)],
                      fill=blend(col, (40, 36, 30), 0.35))
            x += w + rng.randint(10, 40)

    finish(img, "glastonbury", 37)


def roast():
    """Sunday lunch, from above."""
    img = sky((156, 116, 84), (122, 88, 62))
    d = ImageDraw.Draw(img)
    for y in range(0, H, 40):   # table boards
        d.line([(0, y), (W, y)], fill=(104, 74, 52), width=3)

    # One big plate, two side plates, cutlery, a glass.
    d.ellipse([380, 90, 820, 530], fill=(246, 242, 236))
    d.ellipse([410, 120, 790, 500], fill=(238, 232, 224))

    d.pieslice([470, 190, 700, 400], 150, 330, fill=(170, 96, 66))   # meat
    d.pieslice([480, 200, 690, 390], 160, 320, fill=(190, 118, 84))
    for cx, cy, r, col in (
        (640, 380, 46, (222, 190, 120)),   # roast potatoes
        (556, 400, 42, (216, 182, 112)),
        (694, 316, 38, (226, 196, 128)),
        (492, 306, 34, (108, 142, 78)),   # greens
        (528, 246, 30, (120, 152, 84)),
        (700, 236, 32, (216, 138, 70)),   # carrot
    ):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    d.ellipse([516, 224, 700, 300], fill=(150, 92, 60))              # gravy

    d.ellipse([120, 200, 320, 400], fill=(244, 240, 232))
    d.ellipse([880, 240, 1060, 420], fill=(244, 240, 232))
    d.rounded_rectangle([332, 250, 352, 430], 8, fill=(198, 200, 204))   # fork
    d.rounded_rectangle([848, 250, 868, 430], 8, fill=(198, 200, 204))   # knife
    d.ellipse([940, 60, 1060, 180], fill=(196, 214, 216))                # glass
    d.ellipse([956, 76, 1044, 164], fill=(168, 196, 200))

    finish(img, "roast", 43)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for scene in (lisbon, tram, fado, beach, market, london, gig, football, glastonbury, roast):
        scene()
