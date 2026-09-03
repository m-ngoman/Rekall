"""Tiles the audit's screenshots into one sheet per screen — mobile and desktop, dark and light,
side by side — so every state can actually be looked at rather than assumed.

    python3 design/handoff/contact.py [screen ...]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
SRC = HERE / "out/audit"
OUT = HERE / "out/contact"
OUT.mkdir(parents=True, exist_ok=True)

SCREENS = [
    "home", "cards", "calendar", "notes", "tutor", "settings", "study", "study-graded",
    "write-cards", "import", "generate", "exam-sheet", "note-editor", "admin", "onboarding",
]
STATES = [("mobile", "dark"), ("mobile", "light"), ("desktop", "dark"), ("desktop", "light")]

# Full-page shots vary wildly in height; cap so one long screen doesn't shrink the rest to nothing.
MAX_H = 1100
LABEL_H = 26


def pane(screen: str, tag: str, theme: str) -> tuple[str, Image.Image] | None:
    p = SRC / f"{tag}-{theme}-{screen}.png"
    if not p.exists():
        return None
    im = Image.open(p).convert("RGB")
    if im.height > MAX_H:
        im = im.crop((0, 0, im.width, MAX_H))
    return f"{tag}/{theme}", im


for screen in sys.argv[1:] or SCREENS:
    panes = [x for x in (pane(screen, t, th) for t, th in STATES) if x]
    if not panes:
        continue
    gap = 12
    w = sum(p.width for _, p in panes) + gap * (len(panes) - 1)
    h = max(p.height for _, p in panes)
    sheet = Image.new("RGB", (w, h + LABEL_H), (28, 28, 28))
    d = ImageDraw.Draw(sheet)
    x = 0
    for label, im in panes:
        sheet.paste(im, (x, LABEL_H))
        d.text((x + 6, 8), f"{screen}  {label}", fill=(255, 210, 150))
        x += im.width + gap
    out = OUT / f"{screen}.png"
    sheet.save(out)
    print(f"{out}  ({len(panes)} states)")
