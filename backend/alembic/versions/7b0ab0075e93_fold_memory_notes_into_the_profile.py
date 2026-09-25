"""fold memory notes into the profile

The tutor's memory becomes one document the student reads and edits as a whole, instead of a
profile beside a separate list of notes. Each note the student wrote moves into the profile once,
as a line of theirs (`- … [student]`) under the section that fits its category, so nothing they
wrote is lost. Then the notes table and its two enums go.

The auto notes were already folded into the signal log by b74e0d19c5a2, so only manual notes are
left here. Lines are appended after whatever the tutor has written, in the order the notes were
made; a note spanning several lines becomes one.

The downgrade moves every `[student]` line back out as a manual note. Categories come back from the
section each line sits in, so a note filed as "custom" returns as "gap", which is where "custom"
went: the round trip keeps every word but not that one label.

Revision ID: 7b0ab0075e93
Revises: d8f4b1e2a907
Create Date: 2026-09-25 20:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b0ab0075e93'
down_revision: Union[str, None] = 'd8f4b1e2a907'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Written out rather than imported from app.services.student_profile: a migration has to keep
# meaning what it meant when it ran, whatever the app's code becomes.
SECTIONS = ("How they work", "What helps", "Course and level")
SECTION_FOR = {"gap": "How they work", "custom": "How they work", "preference": "What helps", "context": "Course and level"}
CATEGORY_FOR = {"How they work": "gap", "What helps": "preference", "Course and level": "context"}


def _split(body: str) -> dict[str, list[str]]:
    """The document's lines by section, verbatim. Anything outside a known section is kept in
    the first one rather than lost."""
    out: dict[str, list[str]] = {name: [] for name in SECTIONS}
    current = SECTIONS[0]
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("## "):
            name = line[3:].strip()
            current = name if name in SECTIONS else SECTIONS[0]
        elif line:
            out[current].append(line)
    return out


def _join(sections: dict[str, list[str]]) -> str:
    return "\n\n".join("## " + name + "\n" + "\n".join(sections[name]) for name in SECTIONS if sections[name])


def upgrade() -> None:
    bind = op.get_bind()
    notes = bind.execute(
        sa.text(
            "SELECT user_id, category::text AS category, content FROM student_memory_notes "
            "WHERE source = 'manual' ORDER BY user_id, created_at, id"
        )
    ).mappings().all()

    by_user: dict = {}
    for note in notes:
        by_user.setdefault(note["user_id"], []).append(note)

    for user_id, rows in by_user.items():
        existing = bind.execute(
            sa.text("SELECT body FROM student_profiles WHERE user_id = :u"), {"u": user_id}
        ).scalar()
        sections = _split(existing or "")
        seen = {line for lines in sections.values() for line in lines}
        for row in rows:
            text = " ".join(row["content"].split())
            if not text:
                continue
            line = f"- {text} [student]"
            if line in seen:
                continue
            seen.add(line)
            sections[SECTION_FOR.get(row["category"], SECTIONS[0])].append(line)
        body = _join(sections)
        if existing is None:
            bind.execute(
                sa.text(
                    "INSERT INTO student_profiles (id, user_id, body, rev, passes) "
                    "VALUES (gen_random_uuid(), :u, :b, 1, 0)"
                ),
                {"u": user_id, "b": body},
            )
        else:
            bind.execute(
                sa.text("UPDATE student_profiles SET body = :b, rev = rev + 1, updated_at = now() WHERE user_id = :u"),
                {"u": user_id, "b": body},
            )

    op.drop_index(op.f('ix_student_memory_notes_user_id'), table_name='student_memory_notes')
    op.drop_table('student_memory_notes')
    # drop_table leaves the column types behind; see 4d97b779f2f7 for the same step.
    sa.Enum(name='memory_source').drop(bind, checkfirst=True)
    sa.Enum(name='memory_category').drop(bind, checkfirst=True)


def downgrade() -> None:
    op.create_table(
        'student_memory_notes',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('category', sa.Enum('preference', 'gap', 'context', 'custom', name='memory_category'), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('source', sa.Enum('manual', 'auto', name='memory_source'), server_default='manual', nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_student_memory_notes_user_id'), 'student_memory_notes', ['user_id'], unique=False)

    bind = op.get_bind()
    profiles = bind.execute(sa.text("SELECT user_id, body FROM student_profiles")).mappings().all()
    for profile in profiles:
        sections = _split(profile["body"])
        mine = False
        for name in SECTIONS:
            keep = []
            for line in sections[name]:
                if line.startswith("- ") and line.endswith(" [student]"):
                    mine = True
                    bind.execute(
                        sa.text(
                            "INSERT INTO student_memory_notes (id, user_id, category, content, source) "
                            "VALUES (gen_random_uuid(), :u, CAST(:c AS memory_category), :t, 'manual')"
                        ),
                        {"u": profile["user_id"], "c": CATEGORY_FOR[name], "t": line[2 : -len(" [student]")]},
                    )
                else:
                    keep.append(line)
            sections[name] = keep
        if mine:
            bind.execute(
                sa.text("UPDATE student_profiles SET body = :b, rev = rev + 1 WHERE user_id = :u"),
                {"u": profile["user_id"], "b": _join(sections)},
            )
