"""Run the eval set against each prompt variant on the real grading model.

Two things are measured at once, because one run answers both questions:

  quality  — does the graded score match the gold label, per archetype
  caching  — does `prompt_tokens_details.cached_tokens` come back non-zero

Variants are run in BLOCKS, all items for one variant before moving to the next. That mirrors
production, where one prompt is in use and a user grinds a queue of reviews, and it is the only
way an implicit cache gets a chance to warm. Interleaving variants would guarantee a cold prefix
on every call and prove nothing.

Usage:  python run_eval.py [--variants A_baseline,C_fewshot] [--limit 10] [--strictness balanced]
"""

import argparse
import json
import pathlib
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import prompts  # noqa: E402

HERE = pathlib.Path(__file__).parent
MODEL = "google/gemini-2.5-flash"
ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

# Same contract the production parser expects.
RESULT_RE = re.compile(r"###SCORE:\s*(\d)")

# Production short-circuits these in code before the model is ever called (grading.py:_DONT_KNOW),
# so an eval that sends them to the model would be measuring a path that does not exist.
DONT_KNOW = {
    "i don't know", "i dont know", "dont know", "don't know", "no idea", "not sure",
    "can't remember", "cant remember", "no clue", "idk", "?", "",
}


def load_key() -> str:
    for line in (HERE.parent / ".env").read_text().splitlines():
        k, _, v = line.partition("=")
        if k.strip() == "OPENROUTER_API_KEY" and v.strip():
            return v.strip().strip('"').strip("'")
    raise SystemExit("OPENROUTER_API_KEY not found in backend/.env")


def grade_one(client: httpx.Client, key: str, variant: str, card: dict, strictness: str) -> dict:
    submitted = (card["submitted"] or "").strip()
    if submitted.lower() in DONT_KNOW:
        return {"id": card["id"], "variant": variant, "score": 1, "skipped": "dont_know_shortcircuit",
                "feedback": "", "prompt_tokens": 0, "cached_tokens": 0, "completion_tokens": 0, "latency_s": 0.0}

    prompt = prompts.render(variant, card["question"], card["reference"], submitted,
                            strictness=strictness, math=card.get("is_math", False))

    last_err = None
    for attempt in range(4):
        try:
            t0 = time.monotonic()
            r = client.post(
                ENDPOINT,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": MODEL,
                    "max_tokens": 250,
                    "temperature": 0.2,          # production value
                    "messages": [{"role": "user", "content": prompt}],
                    "usage": {"include": True},  # ask OpenRouter for the detailed accounting
                },
                timeout=90.0,
            )
            r.raise_for_status()
            body = r.json()
            dt = time.monotonic() - t0
            text = (body["choices"][0]["message"]["content"] or "").strip()
            usage = body.get("usage") or {}
            details = usage.get("prompt_tokens_details") or {}
            m = RESULT_RE.search(text)
            return {
                "id": card["id"],
                "variant": variant,
                "score": int(m.group(1)) if m else None,
                "unparsed": m is None,
                "feedback": RESULT_RE.sub("", text).strip(),
                "prompt_tokens": usage.get("prompt_tokens"),
                "cached_tokens": details.get("cached_tokens", 0),
                "completion_tokens": usage.get("completion_tokens"),
                "cost_usd": usage.get("cost"),
                "latency_s": round(dt, 3),
            }
        except Exception as e:  # noqa: BLE001 - transient API failure, retry with backoff
            last_err = e
            time.sleep(2 ** attempt)
    return {"id": card["id"], "variant": variant, "score": None, "error": str(last_err),
            "feedback": "", "prompt_tokens": 0, "cached_tokens": 0, "completion_tokens": 0, "latency_s": 0.0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", default=",".join(prompts.VARIANTS))
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--strictness", default="balanced")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--out", default="results/run.json")
    args = ap.parse_args()

    cards = json.loads((HERE / "evalset.json").read_text())["cards"]
    if args.limit:
        cards = cards[: args.limit]
    key = load_key()
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]

    results = []
    out = HERE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)

    with httpx.Client() as client:
        for variant in variants:
            pre = prompts.stable_prefix_chars(variant)
            print(f"\n=== {variant} ({len(cards)} cards, stable prefix {pre} chars) ===", flush=True)
            t0 = time.monotonic()
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                block = list(pool.map(lambda c, v=variant: grade_one(client, key, v, c, args.strictness), cards))
            results.extend(block)
            cached = sum(r.get("cached_tokens") or 0 for r in block)
            hits = sum(1 for r in block if (r.get("cached_tokens") or 0) > 0)
            ptok = sum(r.get("prompt_tokens") or 0 for r in block)
            errs = sum(1 for r in block if r.get("error"))
            print(f"  {time.monotonic()-t0:.1f}s | prompt_tokens {ptok} | cached {cached} "
                  f"| cache-hit calls {hits}/{len(block)} | errors {errs}", flush=True)
            out.write_text(json.dumps({"model": MODEL, "strictness": args.strictness,
                                       "results": results}, indent=2))

    out.write_text(json.dumps({"model": MODEL, "strictness": args.strictness, "results": results}, indent=2))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
