"""Run the eval set against each prompt variant on the real grading model.

Two things are measured at once, because one run answers both questions:

  quality  — does the graded score match the gold label, per archetype
  caching  — does `prompt_tokens_details.cached_tokens` come back non-zero

Variants are run in BLOCKS, all items for one variant before moving to the next. That mirrors
production, where one prompt is in use and a user grinds a queue of reviews, and it is the only
way an implicit cache gets a chance to warm. Interleaving variants would guarantee a cold prefix
on every call and prove nothing.

Usage:  python run_eval.py [--variants A_baseline,C_fewshot] [--limit 10] [--strictness balanced]
        python run_eval.py --model openai/gpt-6-luna --variants A_baseline,E_slim

`--model` defaults to whatever CLOUD_GRADING_MODEL is set to in backend/.env, so a bare run
measures what production is actually using rather than what this file was written against. Each
model writes to its own results file by default, because the first thing anyone does with a model
flag is run it twice and compare, and a shared default path silently makes that impossible.
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
# Only the fallback. The real default is production's own setting — see load_env.
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


def load_env() -> dict[str, str]:
    """backend/.env as a dict. Read directly rather than through app.config so the harness stays
    runnable without importing the application — it has no other dependency on it."""
    env = {}
    for line in (HERE.parent / ".env").read_text().splitlines():
        k, _, v = line.partition("=")
        if k.strip() and v.strip():
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def load_key(env: dict[str, str]) -> str:
    key = env.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("OPENROUTER_API_KEY not found in backend/.env")
    return key


def slug(model: str) -> str:
    """A model id as a filename: openai/gpt-6-luna -> openai-gpt-6-luna."""
    return re.sub(r"[^a-z0-9.-]+", "-", model.lower())


def grade_one(client: httpx.Client, key: str, model: str, variant: str, card: dict, strictness: str,
               reasoning: bool = True, max_tokens: int = 250) -> dict:
    submitted = (card["submitted"] or "").strip()
    if submitted.lower() in DONT_KNOW:
        return {"id": card["id"], "model": model, "variant": variant, "score": 1,
                "skipped": "dont_know_shortcircuit",
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
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": 0.2,          # production value
                    "messages": [{"role": "user", "content": prompt}],
                    # Reasoning tokens are drawn from the same max_tokens budget as the answer, so
                    # on a reasoning model they can consume all of it and leave the reply empty --
                    # and ###SCORE is the last line, so anything truncated loses the marker and
                    # falls back to a silent 3. Production has no such control on the grading
                    # path; the tutor's lives at config.tutor_reasoning.
                    **({} if reasoning else {"reasoning": {"enabled": False}}),
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
                "model": model,
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
    return {"id": card["id"], "model": model, "variant": variant, "score": None, "error": str(last_err),
            "feedback": "", "prompt_tokens": 0, "cached_tokens": 0, "completion_tokens": 0, "latency_s": 0.0}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", default=",".join(prompts.VARIANTS))
    ap.add_argument("--max-tokens", type=int, default=250, help="production value is 250 (grading.py)")
    ap.add_argument("--no-reasoning", action="store_true", help="send reasoning.enabled=false")
    ap.add_argument("--model", default=None, help="OpenRouter model id; defaults to CLOUD_GRADING_MODEL in .env")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--strictness", default="balanced")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--out", default=None, help="defaults to results/run-<model>.json")
    args = ap.parse_args()

    env = load_env()
    model = args.model or env.get("CLOUD_GRADING_MODEL") or MODEL
    out_name = args.out or f"results/run-{slug(model)}{'-noreason' if args.no_reasoning else ''}{f'-mt{args.max_tokens}' if args.max_tokens != 250 else ''}.json"

    cards = json.loads((HERE / "evalset.json").read_text())["cards"]
    if args.limit:
        cards = cards[: args.limit]
    key = load_key(env)
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]

    # Every setting that changes what the model is asked, recorded in the file itself. Results that
    # don't say which budget or reasoning switch produced them can't be checked later — the first
    # batch of these was named for a plan ("shipped") that the numbers inside went on to overturn.
    header = {
        "model": model,
        "strictness": args.strictness,
        "reasoning_field_sent": "enabled:false" if args.no_reasoning else "none (provider default)",
        "max_tokens": args.max_tokens,
    }
    results = []
    out = HERE / out_name
    out.parent.mkdir(parents=True, exist_ok=True)

    with httpx.Client() as client:
        for variant in variants:
            pre = prompts.stable_prefix_chars(variant)
            print(f"\n=== {model} | {variant} ({len(cards)} cards, stable prefix {pre} chars) ===", flush=True)
            t0 = time.monotonic()
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                block = list(pool.map(lambda c, m=model, v=variant: grade_one(client, key, m, v, c, args.strictness, not args.no_reasoning, args.max_tokens), cards))
            results.extend(block)
            cached = sum(r.get("cached_tokens") or 0 for r in block)
            hits = sum(1 for r in block if (r.get("cached_tokens") or 0) > 0)
            ptok = sum(r.get("prompt_tokens") or 0 for r in block)
            errs = sum(1 for r in block if r.get("error"))
            print(f"  {time.monotonic()-t0:.1f}s | prompt_tokens {ptok} | cached {cached} "
                  f"| cache-hit calls {hits}/{len(block)} | errors {errs}", flush=True)
            out.write_text(json.dumps({**header, "results": results}, indent=2))

    out.write_text(json.dumps({**header, "results": results}, indent=2))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
