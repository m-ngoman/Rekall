"""Builds mock-vs-app side-by-side sheets so the two can be judged against each other.

The mock artboards carry a phone frame and a fake status bar; the app screenshots don't. Rows
are aligned on content by cropping the mock's chrome away, not by stretching either side —
a resized comparison would hide exactly the size differences we're looking for.

    python3 design/handoff/compare.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
MOCK = HERE / "out/mock"
APP = HERE / "out/app"
OUT = HERE / "out/compare"
OUT.mkdir(parents=True, exist_ok=True)

# The mock artboard at 2x: 54px status bar and a 1px frame, both absent from the app.
STATUS_BAR = 54 * 2
FRAME = 2

SCREENS = ["home", "cards", "calendar", "notes", "tutor", "settings", "study", "study-graded"]
LABEL_H = 44


def load_mock(tag: str, theme: str, screen: str) -> Image.Image | None:
    p = MOCK / f"{tag}-{theme}-{screen}.png"
    if not p.exists():
        return None
    im = Image.open(p).convert("RGB")
    if tag == "mobile":
        # Drop the frame and the status bar so the first real row lines up with the app's.
        im = im.crop((FRAME, STATUS_BAR + FRAME, im.width - FRAME, im.height - FRAME))
    return im


def load_app(tag: str, theme: str, screen: str) -> Image.Image | None:
    p = APP / f"{tag}-{theme}-{screen}.png"
    return Image.open(p).convert("RGB") if p.exists() else None


for tag in ("mobile", "desktop"):
    for theme in ("dark", "light"):
        for screen in SCREENS:
            m, a = load_mock(tag, theme, screen), load_app(tag, theme, screen)
            if m is None or a is None:
                continue
            h = max(m.height, a.height)
            gap = 24
            sheet = Image.new("RGB", (m.width + a.width + gap, h + LABEL_H), (24, 24, 24))
            sheet.paste(m, (0, LABEL_H))
            sheet.paste(a, (m.width + gap, LABEL_H))
            d = ImageDraw.Draw(sheet)
            d.text((8, 14), f"MOCK  {tag}/{theme}/{screen}", fill=(255, 255, 255))
            d.text((m.width + gap + 8, 14), f"APP  {tag}/{theme}/{screen}", fill=(255, 200, 120))
            # A few horizontal rules make vertical drift between the two obvious at a glance.
            for y in range(LABEL_H, h + LABEL_H, 200):
                d.line([(0, y), (sheet.width, y)], fill=(70, 70, 70), width=1)
            out = OUT / f"{tag}-{theme}-{screen}.png"
            sheet.save(out)
            print(out)
