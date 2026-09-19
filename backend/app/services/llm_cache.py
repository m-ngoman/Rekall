"""The two questions about prompt caching that aren't specific to what is being cached.

Anthropic models bill a cached prefix at a tenth of the input price. Two callers want that for
different reasons — the tutor re-sends a whole conversation every turn, and card generation sends
the same page images to a draft pass and a verify pass — but *how* each one arranges its prefix is
its own business. Only "does this model cache" and "did it" are shared, so only those live here.

Deliberately not a home for breakpoint placement. The tutor marks whole messages under a
two-breakpoint strategy for a conversation; generation marks one content block inside a single
user turn. One abstraction over both would be a parameter bag that serves neither.
"""

import logging

logger = logging.getLogger(__name__)

# Only Anthropic models take these markers. OpenRouter passes `cache_control` through to Anthropic
# and ignores it elsewhere, but the wrapping alone (content as a list of parts) is a shape other
# providers needn't be handed, so it is applied by model family rather than unconditionally.
_CACHEABLE_PREFIXES = ("anthropic/",)


def supports_cache_control(model: str) -> bool:
    return model.startswith(_CACHEABLE_PREFIXES)


def log_cache(label: str, usage: dict) -> None:
    """Whether the cache actually worked, which is not otherwise observable.

    A breakpoint below the model's minimum cacheable size is ignored silently — no error, just
    full-price tokens forever. Logging the read/write split is the only way that shows up, and the
    minimum is high enough to matter: 4096 tokens on Haiku 4.5, against 1024 on Sonnet 5.

    `label` names the caller, because the two have different expected shapes and a line saying
    "no hit" is only alarming for one of them. A single-page generation is below the minimum by
    design and will always say no hit.
    """
    details = usage.get("prompt_tokens_details") or {}
    read = details.get("cached_tokens", 0)
    written = details.get("cache_write_tokens", 0)
    total = usage.get("prompt_tokens")
    if read or written:
        logger.info("%s cache: %s read, %s written of %s prompt tokens", label, read, written, total)
    else:
        logger.info("%s cache: no hit (%s prompt tokens) — check the prefix is above the model minimum", label, total)
