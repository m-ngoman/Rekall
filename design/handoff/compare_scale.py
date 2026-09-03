"""Three-up sheets for the type-scale decision: mock | app at 106% (live) | app at 100%.

    python3 design/handoff/compare_scale.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
OUT = HERE / "out/compare"
OUT.mkdir(parents=True, exist_ok=True)

STATUS_BAR = 54 * 2
FRAME = 2
LABEL_H = 44
GAP = 20


def mock(screen: str) -> Image.Image:
    im = Image.open(HERE / f"out/mock/mobile-dark-{screen}.png").convert("RGB")
    return im.crop((FRAME, STATUS_BAR + FRAME, im.width - FRAME, im.height - FRAME))


for screen in ("home", "calendar"):
    panes = [
        ("MOCK (the doc)", mock(screen)),
        ("APP 106% — live today", Image.open(HERE / f"out/scale/{screen}-106.png").convert("RGB")),
        ("APP 100% — matches doc", Image.open(HERE / f"out/scale/{screen}-100.png").convert("RGB")),
    ]
    w = sum(p.width for _, p in panes) + GAP * (len(panes) - 1)
    h = max(p.height for _, p in panes)
    sheet = Image.new("RGB", (w, h + LABEL_H), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    x = 0
    for label, im in panes:
        sheet.paste(im, (x, LABEL_H))
        d.text((x + 8, 14), label, fill=(255, 220, 160))
        x += im.width + GAP
    # Rules every 200px make vertical drift between the three obvious.
    for y in range(LABEL_H, h + LABEL_H, 200):
        d.line([(0, y), (sheet.width, y)], fill=(70, 70, 70), width=1)
    out = OUT / f"scale-{screen}.png"
    sheet.save(out)
    print(out)
