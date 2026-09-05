"""
The app icon and splash.

The mark is the ampersand: it is the brand's one idea (Cal&der, &handle) and
the only character on the icon, drawn on a calendar page so it still says what
the app is at 60px. The accent blue is the app's one accent colour.

Run:  python3 tools/icon.py
Out:  src/apps/mobile/assets/icon.png            1024x1024, opaque (App Store)
      src/apps/mobile/assets/adaptive-icon.png   1024x1024, transparent, safe zone
      src/apps/mobile/assets/splash-icon.png     512x512, transparent, for the splash
      src/apps/mobile/assets/favicon.png         48x48
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "src/apps/mobile/assets"
FONT = "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf"

ACCENT = (76, 111, 255)
ACCENT_DEEP = (58, 88, 224)
BAND = (40, 60, 170)
WHITE = (255, 255, 255)
INK = (18, 20, 26)


def gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img


def page(d: ImageDraw.ImageDraw, box: tuple, radius: int, band: int) -> None:
    """A calendar page: white sheet, coloured header band, two ring holes."""
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius, fill=WHITE)
    d.rounded_rectangle((x0, y0, x1, y0 + band + radius), radius, fill=BAND)
    d.rectangle((x0, y0 + band - radius, x1, y0 + band), fill=BAND)
    w = x1 - x0
    for cx in (x0 + w * 0.3, x0 + w * 0.7):
        r = band * 0.16
        d.rounded_rectangle((cx - r, y0 + band * 0.32, cx + r, y0 + band * 0.68), r, fill=WHITE)


def ampersand(img: Image.Image, box: tuple, colour: tuple) -> None:
    x0, y0, x1, y1 = box
    h = y1 - y0
    font = ImageFont.truetype(FONT, int(h * 1.12))
    d = ImageDraw.Draw(img)
    # Centre optically: glyph bounds, not the em box.
    bx0, by0, bx1, by1 = d.textbbox((0, 0), "&", font=font)
    gw, gh = bx1 - bx0, by1 - by0
    x = x0 + (x1 - x0 - gw) / 2 - bx0
    y = y0 + (h - gh) / 2 - by0
    d.text((x, y), "&", font=font, fill=colour)


def icon(size: int = 1024) -> Image.Image:
    img = gradient(size, ACCENT, ACCENT_DEEP)
    d = ImageDraw.Draw(img)
    m = size * 0.17
    page(d, (m, m * 1.05, size - m, size - m * 0.95), int(size * 0.075), int(size * 0.14))
    ampersand(img, (m, m * 1.05 + size * 0.14, size - m, size - m * 0.95), ACCENT)
    return img


def adaptive(size: int = 1024) -> Image.Image:
    """Android draws its own background and masks to a shape: keep the mark inside the 66% safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = size * 0.24
    page(d, (m, m * 1.05, size - m, size - m * 0.95), int(size * 0.06), int(size * 0.11))
    ampersand(img, (m, m * 1.05 + size * 0.11, size - m, size - m * 0.95), ACCENT)
    return img


def splash(size: int = 512) -> Image.Image:
    """Just the mark, on transparency; the splash background colour is in app.json."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = size * 0.16
    page(d, (m, m, size - m, size - m), int(size * 0.07), int(size * 0.13))
    ampersand(img, (m, m + size * 0.13, size - m, size - m), ACCENT)
    return img


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    icon().save(OUT / "icon.png", optimize=True)
    adaptive().save(OUT / "adaptive-icon.png", optimize=True)
    splash().save(OUT / "splash-icon.png", optimize=True)
    icon(48).save(OUT / "favicon.png", optimize=True)
    print("wrote icon, adaptive-icon, splash-icon, favicon")
