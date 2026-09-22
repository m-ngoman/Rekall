"""The auto profile's document format: parsing, what counts as a legal edit, and staleness.

All pure, no database. This is where a model's output is either accepted or refused, so it is the
part that has to be right — a malformed section reaching the tutor's system prompt is read on
every turn until someone notices.
"""

from datetime import date

from app.services.student_profile import (
    MAX_LINE_CHARS,
    MAX_LINES_PER_SECTION,
    SECTIONS,
    Line,
    apply_op,
    for_prompt,
    parse,
    parse_line,
    render,
    stale_lines,
    validate_section_body,
)

TODAY = date(2026, 9, 21)
BUDGET = 1500

DOC = """## How they work
- When a problem has more than one step, reaches for a formula before finishing the question. [3 sessions, latest 2026-09-14]
- Answers confidently and checks nothing. [2 sessions, latest 2026-09-07]

## Course and level
- Second-year undergraduate biology. [6 sessions, latest 2026-09-18]"""


class TestParsing:
    def test_round_trips(self):
        assert render(parse(DOC)) == DOC

    def test_sections_and_lines(self):
        parsed = parse(DOC)
        assert len(parsed["How they work"]) == 2
        assert parsed["What helps"] == []
        assert parsed["Course and level"][0].sessions == 6
        assert parsed["Course and level"][0].latest == date(2026, 9, 18)

    def test_an_unknown_heading_and_its_contents_are_dropped(self):
        # Lenient on read: a document already in the database is whatever it is, and refusing to
        # read it would take the whole profile offline.
        parsed = parse(DOC + "\n\n## Vibes\n- Seems nice. [9 sessions, latest 2026-09-01]")
        assert "Vibes" not in parsed
        assert sum(len(v) for v in parsed.values()) == 3

    def test_a_line_with_no_tag_is_dropped(self):
        assert parse("## What helps\n- Likes analogies.")["What helps"] == []

    def test_singular_session_parses(self):
        assert parse_line("- Does a thing. [1 session, latest 2026-09-01]").sessions == 1

    def test_one_session_renders_singular(self):
        assert Line("Does a thing.", 1, TODAY).render().endswith("[1 session, latest 2026-09-21]")

    def test_the_tag_does_not_match_prose_the_model_wrote(self):
        # The anchor matters: a line has to end with the real tag, not merely contain brackets.
        assert parse_line("- Tends to guess [and then check]. ") is None
        assert parse_line("- A thing. [several sessions, latest 2026-09-01]") is None
        assert parse_line("- A thing. [2 sessions, latest last Tuesday]") is None

    def test_an_impossible_date_is_refused_rather_than_raising(self):
        assert parse_line("- A thing. [2 sessions, latest 2026-02-31]") is None

    def test_empty_document(self):
        assert parse("") == {name: [] for name in SECTIONS}
        assert render(parse("")) == ""


class TestValidation:
    def test_accepts_a_good_section(self):
        lines, error = validate_section_body("- A pattern. [2 sessions, latest 2026-09-01]")
        assert error is None and len(lines) == 1

    def test_rejects_too_many_lines(self):
        body = "\n".join(f"- Pattern {i}. [2 sessions, latest 2026-09-01]" for i in range(MAX_LINES_PER_SECTION + 1))
        _, error = validate_section_body(body)
        assert error and str(MAX_LINES_PER_SECTION) in error

    def test_rejects_an_overlong_line(self):
        long = "x" * (MAX_LINE_CHARS + 20)
        _, error = validate_section_body(f"- {long} [2 sessions, latest 2026-09-01]")
        assert error and str(MAX_LINE_CHARS) in error

    def test_rejects_a_line_with_no_tag(self):
        _, error = validate_section_body("- Just a sentence with no evidence.")
        assert error and "sessions, latest" in error

    def test_blank_lines_are_ignored_not_counted(self):
        lines, error = validate_section_body("\n- A. [1 session, latest 2026-09-01]\n\n- B. [1 session, latest 2026-09-02]\n")
        assert error is None and len(lines) == 2


class TestApplyOp:
    def test_rejects_an_invented_section(self):
        new, error = apply_op(DOC, "Vibes", "- A. [2 sessions, latest 2026-09-01]", BUDGET)
        assert new is None and error and "not a section" in error

    def test_writes_a_section_and_leaves_the_others_alone(self):
        new, error = apply_op(DOC, "What helps", "- Follows a worked example. [2 sessions, latest 2026-09-20]", BUDGET)
        assert error is None
        parsed = parse(new)
        assert len(parsed["What helps"]) == 1
        # The untouched sections must survive byte for byte — this is a section rewrite, not a
        # document rewrite, and the whole cost argument depends on that.
        assert render({**parsed, "What helps": []}) == render({**parse(DOC), "What helps": []})

    def test_consolidating_three_specifics_into_one_pattern(self):
        # The thing the old append-only design could not express: the generalisation looked like a
        # duplicate of each note behind it and was rejected at insert time.
        specifics = (
            "## How they work\n"
            "- Confuses parabolic and exponential curves. [1 session, latest 2026-09-01]\n"
            "- Confuses distance and displacement. [1 session, latest 2026-09-05]\n"
            "- Confuses speed and velocity. [1 session, latest 2026-09-09]"
        )
        new, error = apply_op(
            specifics,
            "How they work",
            "- When two quantities have similar names, treats them as interchangeable. [3 sessions, latest 2026-09-09]",
            BUDGET,
        )
        assert error is None
        assert len(parse(new)["How they work"]) == 1

    def test_an_identical_body_is_a_decline_not_an_error(self):
        # Rewriting a section for phrasing costs a cache invalidation on the tutor's system prompt
        # and buys nothing, so it is treated as "nothing to do" rather than a failure.
        same = "\n".join(line.render() for line in parse(DOC)["How they work"])
        new, error = apply_op(DOC, "How they work", same, BUDGET)
        assert new is None and error is None

    def test_rejects_going_over_budget_and_says_by_how_much(self):
        # Each line is legal on its own; it is the whole document that will not fit. That is the
        # case the cap exists for — it is what forces a merge rather than an addition.
        body = "\n".join(f"- {'x' * 100} [2 sessions, latest 2026-09-01]" for _ in range(MAX_LINES_PER_SECTION))
        assert all(len(line) <= MAX_LINE_CHARS for line in body.splitlines())
        new, error = apply_op(DOC, "What helps", body, 300)
        assert new is None and error and "300" in error

    def test_can_empty_a_section(self):
        new, error = apply_op(DOC, "How they work", "- One left. [2 sessions, latest 2026-09-14]", BUDGET)
        assert error is None and len(parse(new)["How they work"]) == 1

    def test_writes_into_an_empty_profile(self):
        new, error = apply_op("", "Course and level", "- A-level chemistry. [2 sessions, latest 2026-09-20]", BUDGET)
        assert error is None
        assert new.startswith("## Course and level")


class TestStaleness:
    def test_a_quiet_line_is_withheld_from_the_prompt_but_kept(self):
        # 2026-09-07 is 14 days before TODAY, so a 10-day window drops it.
        shown = for_prompt(DOC, TODAY, stale_days=10)
        assert "Answers confidently" not in shown
        assert "reaches for a formula" in shown
        # Still in the document — the UI greys it, and a pattern that comes back gets re-dated.
        assert "Answers confidently" in DOC
        assert stale_lines(DOC, TODAY, stale_days=10) == {"Answers confidently and checks nothing."}

    def test_nothing_is_stale_inside_the_window(self):
        assert for_prompt(DOC, TODAY, stale_days=60) == DOC
        assert stale_lines(DOC, TODAY, stale_days=60) == set()

    def test_a_section_emptied_by_staleness_loses_its_heading(self):
        shown = for_prompt(DOC, TODAY, stale_days=1)
        assert shown == ""

    def test_empty_document(self):
        assert for_prompt("", TODAY, stale_days=60) == ""
