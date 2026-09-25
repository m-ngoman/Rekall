"""The auto profile's document format: parsing, what counts as a legal edit, and staleness.

All pure, no database. This is where a model's output is either accepted or refused, so it is the
part that has to be right — a malformed section reaching the tutor's system prompt is read on
every turn until someone notices.
"""

from datetime import date

from app.services.student_profile import (
    MAX_LINE_CHARS,
    MAX_LINES_PER_SECTION,
    MAX_YOURS_LINE_CHARS,
    SECTIONS,
    Line,
    apply_edit,
    apply_op,
    for_prompt,
    parse,
    parse_line,
    plain,
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


# --- the student's own lines ---------------------------------------------------------------------

MINE = """## How they work
- When a problem has more than one step, reaches for a formula before finishing the question. [3 sessions, latest 2026-09-14]
- I learn better when asked before being told. [student]

## Course and level
- Second-year undergraduate biology. [6 sessions, latest 2026-09-18]
- Resitting organic chemistry in the spring. [student]"""


class TestYoursLines:
    def test_round_trip(self):
        assert render(parse(MINE)) == MINE
        mine = parse(MINE)["How they work"][1]
        assert mine.yours and mine.text == "I learn better when asked before being told."
        assert parse_line("- Stop telling me I rush. [student]") == Line("Stop telling me I rush.", yours=True)

    def test_they_never_go_quiet(self):
        # A year on, the tutor's dated lines have lapsed; the student's have no evidence to age.
        shown = for_prompt(MINE, date(2027, 9, 21), stale_days=60)
        assert "asked before being told" in shown and "Resitting organic chemistry" in shown
        assert "reaches for a formula" not in shown
        assert stale_lines(MINE, date(2027, 9, 21), stale_days=60) == {
            "When a problem has more than one step, reaches for a formula before finishing the question.",
            "Second-year undergraduate biology.",
        }

    def test_a_rewrite_must_keep_them_word_for_word(self):
        pattern = "- When a problem has more than one step, reaches for a formula first. [4 sessions, latest 2026-09-20]"
        kept = pattern + "\n- I learn better when asked before being told. [student]"
        new, error = apply_op(MINE, "How they work", kept, BUDGET)
        assert error is None and "reaches for a formula first" in new and "asked before being told. [student]" in new

        dropped, error = apply_op(MINE, "How they work", pattern, BUDGET)
        assert dropped is None and "missing: I learn better when asked before being told." in error

        reworded = pattern + "\n- Learns better when asked before being told. [student]"
        new, error = apply_op(MINE, "How they work", reworded, BUDGET)
        assert new is None and "[student]" in error

    def test_the_model_cannot_speak_for_the_student(self):
        body = (
            "- When a problem has more than one step, reaches for a formula before finishing the question. [3 sessions, latest 2026-09-14]\n"
            "- I learn better when asked before being told. [student]\n"
            "- Likes flashcards best. [student]"
        )
        new, error = apply_op(MINE, "How they work", body, BUDGET)
        assert new is None and "not the student's: Likes flashcards best." in error

    def test_the_line_cap_counts_the_tutors_lines_only(self):
        ours = "\n".join(f"- Pattern {i}. [2 sessions, latest 2026-09-01]" for i in range(MAX_LINES_PER_SECTION))
        body = ours + "\n- I learn better when asked before being told. [student]"
        new, error = apply_op(MINE, "How they work", body, BUDGET)
        assert error is None and len(parse(new)["How they work"]) == MAX_LINES_PER_SECTION + 1

    def test_a_long_line_of_theirs_is_not_the_models_to_refuse(self):
        long = "I " + "really " * 30 + "like worked examples."
        assert MAX_LINE_CHARS < len(long) + 12 <= MAX_YOURS_LINE_CHARS
        lines, error = validate_section_body(f"- {long} [student]")
        assert error is None and lines[0].yours


# --- editing the whole file ----------------------------------------------------------------------


class TestEditing:
    def test_the_student_sees_every_heading_and_no_tags(self):
        assert plain(MINE) == (
            "## How they work\n"
            "- When a problem has more than one step, reaches for a formula before finishing the question.\n"
            "- I learn better when asked before being told.\n\n"
            "## What helps\n\n"
            "## Course and level\n"
            "- Second-year undergraduate biology.\n"
            "- Resitting organic chemistry in the spring."
        )
        assert plain("") == "## How they work\n\n## What helps\n\n## Course and level"

    def test_saving_it_unchanged_changes_nothing(self):
        edit = apply_edit(MINE, plain(MINE), BUDGET)
        assert edit.body is None and edit.removed == [] and edit.error is None

    def test_what_they_keep_keeps_its_tag_and_what_they_type_is_theirs(self):
        edited = plain(MINE).replace("## What helps", "## What helps\n- Diagrams, always diagrams.")
        edit = apply_edit(MINE, edited, BUDGET)
        sections = parse(edit.body)
        assert sections["What helps"] == [Line("Diagrams, always diagrams.", yours=True)]
        assert sections["How they work"][0].sessions == 3  # the tutor's evidence survives the round trip
        assert edit.removed == []

    def test_a_tutor_line_taken_out_is_reported_for_suppression(self):
        edited = plain(MINE).replace("- Second-year undergraduate biology.\n", "")
        edit = apply_edit(MINE, edited, BUDGET)
        assert "Second-year" not in edit.body
        assert edit.removed == ["Second-year undergraduate biology."]

    def test_a_line_of_theirs_taken_out_is_just_gone(self):
        edited = plain(MINE).replace("- I learn better when asked before being told.\n", "")
        edit = apply_edit(MINE, edited, BUDGET)
        assert "asked before being told" not in edit.body and edit.removed == []

    def test_a_reworded_tutor_line_becomes_theirs_and_the_original_is_suppressed(self):
        edited = plain(MINE).replace("Second-year undergraduate biology.", "Third-year biology, actually.")
        edit = apply_edit(MINE, edited, BUDGET)
        assert Line("Third-year biology, actually.", yours=True) in parse(edit.body)["Course and level"]
        assert edit.removed == ["Second-year undergraduate biology."]

    def test_lines_without_a_known_heading_go_into_the_first_section(self):
        edit = apply_edit("", "Likes a challenge.\n\n## Hobbies\n- Plays chess.", BUDGET)
        assert [line.text for line in parse(edit.body)["How they work"]] == ["Likes a challenge.", "Plays chess."]

    def test_headings_are_read_however_they_are_typed(self):
        edit = apply_edit("", "### what helps ###\n* Short sessions.\n# Course And Level\n• Year 12.", BUDGET)
        sections = parse(edit.body)
        assert sections["What helps"] == [Line("Short sessions.", yours=True)]
        assert sections["Course and level"] == [Line("Year 12.", yours=True)]

    def test_a_pasted_tag_is_not_taken_at_face_value(self):
        # Typing a tutor-style tag doesn't make a line the tutor's, or give it evidence.
        edit = apply_edit("", "## What helps\n- Short sessions. [9 sessions, latest 2026-09-01]", BUDGET)
        assert parse(edit.body)["What helps"] == [Line("Short sessions.", yours=True)]

    def test_a_line_written_twice_is_kept_once(self):
        edit = apply_edit("", "## What helps\n- Short sessions.\n- Short  sessions.", BUDGET)
        assert parse(edit.body)["What helps"] == [Line("Short sessions.", yours=True)]

    def test_growing_past_the_cap_is_refused(self):
        edit = apply_edit(MINE, plain(MINE) + "\n- " + "x" * 200, 400)
        assert edit.body is None and "400" in edit.error

    def test_a_file_already_over_the_cap_can_still_be_cut_down(self):
        edited = plain(MINE).replace("- Resitting organic chemistry in the spring.", "")
        edit = apply_edit(MINE, edited, 100)
        assert edit.error is None and "Resitting" not in edit.body

    def test_an_overlong_line_is_refused(self):
        edit = apply_edit("", "## What helps\n- " + "y" * (MAX_YOURS_LINE_CHARS + 1), 10_000)
        assert edit.body is None and str(MAX_YOURS_LINE_CHARS) in edit.error
