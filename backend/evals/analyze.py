"""Compare prompt variants on the graded results.

Score agreement is the headline, but it is not the only thing that can regress when a prompt is
cut or grown. The house-voice rules and the feedback-length banding are things Rekall's prompt
asserts about itself, so they are checked directly rather than assumed to survive.

Pass more than one results file to compare models. Each series is then labelled
`<model>/<variant>` and every table below — headline, per-archetype, disagreements — works
unchanged, because comparing two models is the same shape of question as comparing two prompts.
Do not read across a model change and a prompt change at once: if both move, neither number
attributes to anything.

Usage:  python analyze.py                                   # every results/run-*.json
        python analyze.py results/run-google-gemini-2.5-flash.json results/run-openai-gpt-6-luna.json
"""

import collections
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent

# The prompt forbids these outright: "Never write 'the student', 'the student's answer',
# 'the response', or 'the submission'."
VOICE_BANNED = re.compile(
    r"\b(the student'?s?|the response|the submission|the answer provided|this response)\b", re.I
)


def sentences(text: str) -> int:
    return len([s for s in re.split(r"[.!?]+(?:\s|$)", text.strip()) if s.strip()])


def short(model: str) -> str:
    """`openai/gpt-6-luna` -> `gpt-6-luna`. Vendor prefixes are all the same width and carry no
    information once two models are side by side."""
    return model.split("/")[-1]


def main() -> None:
    args = sys.argv[1:]
    if args:
        paths = [HERE / a for a in args]
    else:
        paths = sorted(HERE.glob("results/run-*.json")) or [HERE / "results/run.json"]

    payloads = []
    for path in paths:
        if not path.exists():
            raise SystemExit(f"no such results file: {path}")
        payload = json.loads(path.read_text())
        # Keyed by file, not by model. Two runs of the SAME model with different settings — the
        # obvious next experiment once a model misbehaves — would otherwise pool into one series
        # and silently average the broken run with the fixed one.
        payload["_run"] = path.stem.removeprefix("run-")
        payloads.append(payload)

    cards = {c["id"]: c for c in json.loads((HERE / "evalset.json").read_text())["cards"]}
    models = [p["model"] for p in payloads]
    multi = len(payloads) > 1

    # One series per thing being compared. With a single model that is the variant, exactly as
    # before; with several it is model/variant, and every table downstream is unchanged.
    by_variant = collections.defaultdict(list)
    for payload in payloads:
        for r in payload["results"]:
            name = r.get("variant", "?")
            key = f"{payload['_run']}/{name}" if multi else name
            by_variant[key].append(r)

    strictness = ", ".join(sorted({p["strictness"] for p in payloads}))
    print(f"model: {', '.join(models)}   strictness: {strictness}   "
          f"cards: {len(cards)}   series: {len(by_variant)}\n")

    # ---- headline table -------------------------------------------------
    label_w = max(14, max(len(v) for v in by_variant) + 1)
    hdr = (f"{'series':{label_w}} {'exact':>7} {'±1':>7} {'MAE':>6} {'bias':>7} "
           f"{'voice':>7} {'fmt':>6} {'ptok':>7} {'$/1k':>8}")
    print(hdr)
    print("-" * len(hdr))
    summary = {}
    for v, rs in by_variant.items():
        scored = [r for r in rs if r.get("score") is not None and not r.get("skipped")]
        if not scored:
            continue
        diffs = [r["score"] - cards[r["id"]]["gold"] for r in scored]
        exact = sum(1 for d in diffs if d == 0) / len(diffs)
        within1 = sum(1 for d in diffs if abs(d) <= 1) / len(diffs)
        mae = sum(abs(d) for d in diffs) / len(diffs)
        bias = sum(diffs) / len(diffs)
        voice = sum(1 for r in scored if VOICE_BANNED.search(r["feedback"] or ""))
        fmt = sum(1 for r in rs if r.get("unparsed"))
        ptok = sum(r.get("prompt_tokens") or 0 for r in scored) / len(scored)
        cost = sum(r.get("cost_usd") or 0 for r in scored) / len(scored) * 1000
        summary[v] = dict(exact=exact, within1=within1, mae=mae, bias=bias,
                          voice=voice, fmt=fmt, ptok=ptok, cost_per_1k=cost, n=len(scored))
        print(f"{v:{label_w}} {exact*100:6.1f}% {within1*100:6.1f}% {mae:6.2f} {bias:+7.2f} "
              f"{voice:5}/{len(scored):<2} {fmt:5} {ptok:7.0f} {cost:8.4f}")

    print("\n  exact = graded score equals gold   ±1 = within one point   MAE = mean absolute error")
    print("  bias  = mean signed error (+ grades too generously, - too harshly)")
    print("  voice = replies using banned impersonal phrasing   fmt = missing ###SCORE marker")
    print("  $/1k  = USD per 1,000 gradings\n")

    # ---- per-archetype --------------------------------------------------
    arch = sorted({c["archetype"] for c in cards.values()})
    variants = list(summary)
    w = max(len(a) for a in arch) + 2
    # Single model: the variant's first word is unique and short. Several models: the whole
    # series name, because truncating to the model alone collides the moment one model runs two
    # variants — which is the normal case, since a model swap is judged against both prompts.
    col = {v: (v if multi else v.split("_")[0]) for v in variants}
    cw = max(6, max(len(c) for c in col.values()))
    print(f"{'archetype':{w}} {'n':>3} " + " ".join(f"{col[v]:>{cw}}" for v in variants)
          + "     (mean signed error; 0.00 = matches gold)")
    print("-" * (w + 5 + (cw + 1) * len(variants) + 40))
    for a in arch:
        ids = [i for i, c in cards.items() if c["archetype"] == a]
        cells = []
        for v in variants:
            ds = [r["score"] - cards[r["id"]]["gold"] for r in by_variant[v]
                  if r["id"] in ids and r.get("score") is not None and not r.get("skipped")]
            cells.append(f"{sum(ds)/len(ds):+{cw}.2f}" if ds else " " * (cw - 1) + "-")
        print(f"{a:{w}} {len(ids):>3} " + " ".join(cells))

    # ---- disagreements --------------------------------------------------
    print(f"\n\nITEMS WHERE {'MODELS' if multi else 'VARIANTS'} DISAGREE (sorted by spread)\n")
    disagreements = []
    for cid, card in cards.items():
        got = {v: next((r["score"] for r in by_variant[v]
                        if r["id"] == cid and r.get("score") is not None), None) for v in variants}
        vals = [s for s in got.values() if s is not None]
        if len(vals) >= 2 and max(vals) - min(vals) >= 1:
            disagreements.append((max(vals) - min(vals), cid, card, got))
    disagreements.sort(key=lambda x: -x[0])
    for spread, cid, card, got in disagreements[:14]:
        marks = " ".join(f"{col[v]}={got[v]}" for v in variants if got[v] is not None)
        flag = " [CONTESTED]" if card.get("contested") else ""
        print(f"  {cid}  gold={card['gold']}  spread={spread}  {marks}{flag}")
        print(f"     {card['archetype']} | Q: {card['question'][:88]}")
        print(f"     typed: {card['submitted'][:88]}")

    json.dump(summary, open(HERE / "results/summary.json", "w"), indent=2)
    print(f"\n{len(disagreements)} of {len(cards)} items split the {'models' if multi else 'variants'}.")


if __name__ == "__main__":
    main()
