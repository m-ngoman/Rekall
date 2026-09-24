"""The two ways a free-text field is cleaned on its way in, so every endpoint that takes one
stores it the same way."""

from fastapi import HTTPException


def clean_optional(value: str | None) -> str | None:
    """Trimmed, and None when nothing is left: an optional text field has one spelling of empty,
    which is what previews, search and "is it set" checks read."""
    return (value or "").strip() or None


def require_name(value: str) -> str:
    """A deck's or an exam's name, trimmed. A name made of spaces is no name, and is refused."""
    name = value.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    return name
