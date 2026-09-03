"""Recording that a feature was used.

Deliberately one line of work: add a row to the caller's session and let the caller's own commit
carry it. No commit of its own, no second connection, no try/except.

That last part is the design, not laziness. A metrics write that commits separately can succeed
for work that then fails, and one wrapped in `except: pass` inside somebody else's transaction
leaves that transaction poisoned for every statement after it. Sharing the caller's transaction
means the record is exactly as true as the thing it records: if generation rolls back, so does the
event saying it happened.
"""

import uuid

from sqlalchemy.orm import Session

from app.models import UsageEvent, UsageEventType


def record(db: Session, user_id: uuid.UUID, event: UsageEventType, count: int = 1) -> None:
    """Note one use of `event`. `count` is what that use produced (cards, files); leave it at 1
    for features that produce nothing countable — see UsageEvent.count.

    Pending until the caller commits. Every call site sits next to work that already commits, so
    there is nothing extra to remember.
    """
    db.add(UsageEvent(user_id=user_id, event=event.value, count=count))
