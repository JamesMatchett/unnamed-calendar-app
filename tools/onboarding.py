"""
The welcome carousel's slides.

Drawn, not screenshotted, for the same reason the covers are: a screenshot goes
stale the moment a corner radius changes, and a first-run carousel is the one
place in the app where a stale picture is the first thing anyone sees. These
are the app's own tokens rendered as a stylised screen, so they age with the
design rather than against it.

Each slide is a rounded "screen" on transparency, so it sits on either theme.

Run:  python3 tools/onboarding.py
Out:  src/apps/mobile/assets/onboarding/*.png  (560x900, the aspect of a phone)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "src/apps/mobile/assets/onboarding"
REG = "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf"
BOLD = "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf"

W, H = 560, 900
PAD = 34

# The app's own palette (src/theme.ts), light.
BG = (244, 246, 250)
SURFACE = (255, 255, 255)
BORDER = (223, 227, 236)
TEXT = (18, 20, 26)
MUTED = (90, 96, 114)
ACCENT = (76, 111, 255)
ACCENT_SOFT = (234, 238, 255)
GOING = (31, 157, 107)
MAYBE = (201, 138, 22)
NOT_GOING = (180, 72, 90)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(BOLD if bold else REG, size)


def screen() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, W, H), 44, fill=BG + (255,))
    # A header strip, so the card reads as a screen rather than a poster.
    d.text((PAD, 46), "9:41", font=font(22, True), fill=TEXT)
    d.rounded_rectangle((W - PAD - 46, 44, W - PAD, 66), 11, fill=(210, 214, 224))
    return img, d


def title(d: ImageDraw.ImageDraw, text: str, y: int = 96) -> int:
    d.text((PAD, y), text, font=font(38, True), fill=TEXT)
    return y + 58


def card(d: ImageDraw.ImageDraw, box: tuple, radius: int = 20) -> None:
    d.rounded_rectangle(box, radius, fill=SURFACE + (255,), outline=BORDER + (255,), width=2)


def avatars(d: ImageDraw.ImageDraw, x: int, y: int, colours: list, r: int = 17) -> None:
    for i, c in enumerate(colours):
        cx = x + i * (r * 1.4)
        d.ellipse((cx, y, cx + r * 2, y + r * 2), fill=SURFACE, outline=c, width=3)
        d.ellipse((cx + 4, y + 4, cx + r * 2 - 4, y + r * 2 - 4), fill=c)


def pill(d: ImageDraw.ImageDraw, box: tuple, label: str, colour, filled: bool) -> None:
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, (y1 - y0) / 2, fill=colour if filled else None,
                        outline=colour if not filled else None, width=2)
    f = font(19, filled)
    tw = d.textlength(label, font=f)
    d.text(((x0 + x1 - tw) / 2, y0 + (y1 - y0) / 2 - 13), label, font=f,
           fill=SURFACE if filled else MUTED)


# --- slides ------------------------------------------------------------------


def one_place() -> Image.Image:
    """Everything you are doing, from every calendar, in one list."""
    img, d = screen()
    y = title(d, "This week")

    days = [
        ("Thursday", [("19:00", "Dinner at Brat", "Lisbon, October", GOING),
                      ("21:30", "Fado at Mesa de Frades", "Lisbon, October", MAYBE)]),
        ("Friday", [("09:00", "Flight home", "Lisbon, October", GOING),
                    ("20:00", "Pub quiz", "London things", None)]),
        ("Saturday", [("12:00", "Sunday lunch", "My own plans", GOING)]),
    ]

    for day, events in days:
        d.text((PAD, y), day, font=font(22, True), fill=MUTED)
        y += 38
        for time, name, cal, answer in events:
            card(d, (PAD, y, W - PAD, y + 96))
            d.text((PAD + 22, y + 20), time, font=font(20), fill=MUTED)
            d.text((PAD + 22, y + 46), name, font=font(24, True), fill=TEXT)
            d.text((PAD + 22, y + 76), cal, font=font(17), fill=MUTED)
            if answer:
                d.ellipse((W - PAD - 44, y + 40, W - PAD - 24, y + 60), fill=answer)
            y += 110
        y += 10

    return img


def everyone_answers() -> Image.Image:
    """One tap each, and everybody can see who is actually coming."""
    img, d = screen()
    y = title(d, "Dinner at Brat")
    d.text((PAD, y - 8), "Thursday, 19:00 · Shoreditch", font=font(21), fill=MUTED)
    y += 46

    card(d, (PAD, y, W - PAD, y + 150))
    d.text((PAD + 22, y + 24), "Are you going?", font=font(20), fill=MUTED)
    w = (W - PAD * 2 - 44 - 24) / 3
    for i, (label, colour, filled) in enumerate(
        [("Going", GOING, True), ("Maybe", MAYBE, False), ("Can't", NOT_GOING, False)]
    ):
        x = PAD + 22 + i * (w + 12)
        pill(d, (x, y + 62, x + w, y + 116), label, colour, filled)
    y += 176

    d.text((PAD, y), "Who's going", font=font(22, True), fill=MUTED)
    y += 40
    card(d, (PAD, y, W - PAD, y + 250))
    rows = [("Going", GOING, "You, Priya, Luke"), ("Maybe", MAYBE, "Glenn"),
            ("Can't", NOT_GOING, "Maya"), ("No reply yet", MUTED, "Tom")]
    ry = y + 26
    for label, colour, names in rows:
        d.ellipse((PAD + 24, ry + 8, PAD + 40, ry + 24), fill=colour)
        d.text((PAD + 56, ry), label, font=font(20, True), fill=colour)
        d.text((PAD + 56, ry + 26), names, font=font(20), fill=TEXT)
        ry += 58

    y += 280
    d.text((PAD, y), "Where", font=font(22, True), fill=MUTED)
    y += 40
    card(d, (PAD, y, W - PAD, y + 92))
    d.text((PAD + 24, y + 22), "Brat", font=font(23, True), fill=TEXT)
    d.text((PAD + 24, y + 52), "4 Redchurch Street, E2", font=font(19), fill=MUTED)
    d.rounded_rectangle((W - PAD - 70, y + 26, W - PAD - 24, y + 66), 10, outline=ACCENT, width=3)
    d.line((W - PAD - 58, y + 26, W - PAD - 58, y + 66), fill=ACCENT, width=2)
    d.line((W - PAD - 36, y + 26, W - PAD - 36, y + 66), fill=ACCENT, width=2)

    return img


def pick_together() -> Image.Image:
    """Nobody has to be the one who guesses a date."""
    img, d = screen()
    y = title(d, "When suits everyone?")
    d.text((PAD, y - 8), "4 of 5 answered", font=font(21), fill=MUTED)
    y += 46

    slots = [
        ("Thu 16 Oct", "19:00", 3, 1, 0, True),
        ("Fri 17 Oct", "20:00", 2, 1, 1, False),
        ("Sat 18 Oct", "13:00", 1, 0, 3, False),
        ("Sun 19 Oct", "12:30", 2, 2, 0, False),
    ]
    for day, time, yes, maybe, no, best in slots:
        h = 150
        card(d, (PAD, y, W - PAD, y + h))
        if best:
            d.rounded_rectangle((PAD, y, W - PAD, y + h), 20, outline=GOING, width=3)
            d.rounded_rectangle((W - PAD - 132, y + 20, W - PAD - 22, y + 52), 16, outline=GOING, width=2)
            d.text((W - PAD - 118, y + 26), "Best so far", font=font(17), fill=GOING)
        d.text((PAD + 22, y + 22), f"{day} · {time}", font=font(24, True), fill=TEXT)
        d.text((PAD + 22, y + 54), "Priya suggested this", font=font(18), fill=MUTED)
        for i, (n, colour) in enumerate([(yes, GOING), (maybe, MAYBE), (no, NOT_GOING)]):
            x = PAD + 22 + i * 78
            d.ellipse((x, y + 96, x + 16, y + 112), fill=colour)
            d.text((x + 24, y + 92), str(n), font=font(22, True), fill=colour)
        y += h + 20

    return img


def both_free() -> Image.Image:
    """The intersection nobody can hold in their head."""
    img, d = screen()
    y = title(d, "Catch up with Luke")
    d.text((PAD, y - 8), "Evenings, 2 hours, next fortnight", font=font(21), fill=MUTED)
    y += 52

    # The segmented control, as the app draws it.
    d.rounded_rectangle((PAD, y, W - PAD, y + 58), 14, fill=(227, 230, 237))
    seg = (W - PAD * 2) / 3
    d.rounded_rectangle((PAD + 4, y + 4, PAD + seg - 4, y + 54), 11, fill=SURFACE)
    for i, label in enumerate(["Evenings", "Daytime", "Weekend"]):
        f = font(20, i == 0)
        tw = d.textlength(label, font=f)
        d.text((PAD + seg * i + (seg - tw) / 2, y + 16), label, font=f,
               fill=TEXT if i == 0 else MUTED)
    y += 86

    card(d, (PAD, y, W - PAD, y + 410))
    rows = [("Tuesday 14 October", "19:00 to 21:00"),
            ("Thursday 16 October", "18:30 to 20:30"),
            ("Saturday 18 October", "19:00 to 21:00"),
            ("Monday 20 October", "20:00 to 22:00"),
            ("Wednesday 22 October", "19:30 to 21:30")]
    ry = y + 26
    for day, when in rows:
        d.text((PAD + 24, ry), day, font=font(23, True), fill=TEXT)
        d.text((PAD + 24, ry + 30), when, font=font(20), fill=MUTED)
        d.ellipse((W - PAD - 60, ry + 10, W - PAD - 24, ry + 46), outline=ACCENT, width=3)
        d.line((W - PAD - 51, ry + 28, W - PAD - 33, ry + 28), fill=ACCENT, width=3)
        d.line((W - PAD - 42, ry + 19, W - PAD - 42, ry + 37), fill=ACCENT, width=3)
        ry += 80

    y += 440
    d.text((PAD, y), "Neither of you has anything on.", font=font(20), fill=MUTED)
    d.text((PAD, y + 30), "Picking one drafts the invitation.", font=font(20), fill=MUTED)

    return img


SLIDES = [
    ("one-place", one_place),
    ("everyone-answers", everyone_answers),
    ("pick-together", pick_together),
    ("both-free", both_free),
]


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in SLIDES:
        # RGBA keeps the rounded corners transparent, so the octree method
        # (the only one that takes alpha) does the palette.
        img = fn().quantize(colors=128, method=Image.FASTOCTREE)
        img.save(OUT / f"{name}.png", optimize=True)
        print("wrote", name)
