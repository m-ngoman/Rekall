"""One sheet per viewport+theme showing every screen as a mock-vs-app pair, so the whole set can
be scanned for structural mismatches in four images instead of thirty-two.

Spot-checking is how desktop Home stayed unexamined for a whole session: the mock was looked at on
its own early on and its comparison sheet never was.

    python3 design/handoff/grand.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
MOCK = HERE / "out/mock"
APP = HERE / "out/app"
OUT = HERE / "out/grand"
OUT.mkdir(parents=True, exist_ok=True)

SCREENS = ["home", "cards", "calendar", "notes", "tutor", "settings", "study", "study-graded"]
ROW_H = 330          # every pane scaled to this height so rows line up
STATUS_BAR = 54 * 2  # the mobile mock's fake status bar, cropped so content aligns
FRAME = 2
LABEL_W = 120


def scaled(path: Path, crop_chrome: bool) -> Image.Image | None:
    if not path.exists():
        return None
    im = Image.open(path).convert("RGB")
    if crop_chrome:
        im = im.crop((FRAME, STATUS_BAR + FRAME, im.width - FRAME, im.height - FRAME))
    w = max(1, round(im.width * ROW_H / im.height))
    return im.resize((w, ROW_H), Image.LANCZOS)


for tag in ("mobile", "desktop"):
    for theme in ("dark", "light"):
        rows = []
        for s in SCREENS:
            m = scaled(MOCK / f"{tag}-{theme}-{s}.png", crop_chrome=(tag == "mobile"))
            a = scaled(APP / f"{tag}-{theme}-{s}.png", crop_chrome=False)
            if m and a:
                rows.append((s, m, a))
        if not rows:
            continue
        gap = 10
        row_w = max(m.width + a.width + gap for _, m, a in rows)
        sheet = Image.new("RGB", (LABEL_W + row_w, len(rows) * (ROW_H + gap)), (26, 26, 26))
        d = ImageDraw.Draw(sheet)
        y = 0
        for name, m, a in rows:
            d.text((6, y + ROW_H // 2 - 12), name, fill=(255, 214, 150))
            d.text((6, y + ROW_H // 2 + 2), "mock | app", fill=(130, 130, 130))
            sheet.paste(m, (LABEL_W, y))
            sheet.paste(a, (LABEL_W + m.width + gap, y))
            # A hairline between the pair makes a width mismatch obvious.
            d.line([(LABEL_W + m.width + gap // 2, y), (LABEL_W + m.width + gap // 2, y + ROW_H)], fill=(90, 90, 90))
            y += ROW_H + gap
        out = OUT / f"{tag}-{theme}.png"
        sheet.save(out)
        print(f"{out}  ({len(rows)} screens)")
