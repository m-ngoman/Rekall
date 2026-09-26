"""scripts/deploy.sh reads its settings file without running any of it.

The first version of the deploy had systemd read ~/.config/rekall/deploy.env, where an unquoted
value runs to the end of the line. The second sourced the file with bash, where the same line runs
as a command: a server set up with `REKALL_RESTART=sudo systemctl restart rekall-backend` then
stopped deploying at all, every run dying before it did anything. These run the script's
`--settings`, which prints what a deploy would use and does nothing else, with a `systemctl` first
on PATH that leaves a mark if anything in the file is ever run.

Here rather than beside the script because this is the suite that runs.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "deploy.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("git") is None,
    reason="runs scripts/deploy.sh, which needs bash and git",
)


def settings(tmp_path: Path, text: str | None, **env: str) -> tuple[int, dict[str, str], list[str]]:
    """Runs `deploy.sh --settings` with `text` as the settings file (none if None): its exit code,
    the settings it would use, and what it said about lines it skipped."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "systemctl"
    stub.write_text(f"#!/bin/sh\ntouch '{tmp_path / 'ran'}'\nexit 1\n")
    stub.chmod(0o755)
    environment = {"HOME": str(tmp_path / "home"), "PATH": f"{bin_dir}:/usr/bin:/bin", "USER": "rk", **env}
    if text is not None:
        config = tmp_path / "deploy.env"
        config.write_bytes(text.encode())
        environment.setdefault("REKALL_CONFIG", str(config))
    run = subprocess.run(
        ["bash", str(SCRIPT), "--settings"], env=environment, capture_output=True, text=True, timeout=60
    )
    assert not (tmp_path / "ran").exists(), "a line of the settings file was run"
    lines = run.stdout.splitlines()
    values = dict(m.groups() for line in lines if (m := re.match(r"(REKALL_[A-Z_]+|PATH)=(.*)", line)))
    return run.returncode, values, [line for line in lines if "skipped" in line]


def test_a_file_written_for_systemd_reads_as_it_did_there(tmp_path: Path) -> None:
    code, values, skipped = settings(
        tmp_path,
        "# written for systemd's EnvironmentFile\n"
        "REKALL_RESTART=sudo systemctl restart rekall-backend\n"
        "; a comment of systemd's other kind\n"
        "\n"
        "  REKALL_HEALTH_WAIT = 90   \n"
        "REKALL_BRANCH=beta-next\r\n"
        "REKALL_URL=http://127.0.0.1:8001",  # and no newline at the end
    )
    assert code == 0
    assert skipped == []
    assert values["REKALL_RESTART"] == "sudo systemctl restart rekall-backend"
    assert values["REKALL_HEALTH_WAIT"] == "90"
    assert values["REKALL_BRANCH"] == "beta-next"
    assert values["REKALL_URL"] == "http://127.0.0.1:8001"


def test_names_expand_as_the_readme_promises(tmp_path: Path) -> None:
    code, values, _ = settings(tmp_path, "PATH=$HOME/.nvm/bin:${PATH}\nREKALL_BRANCH=release-$USER-$NOT_SET\n")
    assert code == 0
    assert values["PATH"] == f"{tmp_path}/home/.nvm/bin:{tmp_path}/bin:/usr/bin:/bin"
    assert values["REKALL_BRANCH"] == "release-rk-"


def test_quotes_are_taken_off_and_comments_after_values_dropped(tmp_path: Path) -> None:
    code, values, skipped = settings(
        tmp_path,
        'export REKALL_RESTART="systemctl --user restart \\"my\\" rekall.service"  # quoted, as shell has it\n'
        "REKALL_URL='http://127.0.0.1:$PORT'\n"
        "REKALL_VENV=/srv/rekall/beta/backend/.venv # a comment\n"
        'REKALL_BRANCH="release-$USER"\n',
    )
    assert code == 0
    assert skipped == []
    assert values["REKALL_RESTART"] == 'systemctl --user restart "my" rekall.service'
    # Single quotes keep a $ as it is.
    assert values["REKALL_URL"] == "http://127.0.0.1:$PORT"
    assert values["REKALL_VENV"] == "/srv/rekall/beta/backend/.venv"
    assert values["REKALL_BRANCH"] == "release-rk"


def test_nothing_else_a_shell_would_do_is_done(tmp_path: Path) -> None:
    code, values, _ = settings(tmp_path, "REKALL_RESTART=$(systemctl restart x) `systemctl` ~ *\n")
    assert code == 0
    assert values["REKALL_RESTART"] == "$(systemctl restart x) `systemctl` ~ *"


def test_a_line_that_is_not_a_setting_is_reported_and_the_rest_still_read(tmp_path: Path) -> None:
    code, values, skipped = settings(
        tmp_path,
        'systemctl restart rekall-backend\nREKALL_URL="never closed\nUID=5\nREKALL_BRANCH=beta-next\n',
    )
    assert code == 0
    assert len(skipped) == 3
    assert ["line 1" in skipped[0], "line 2" in skipped[1], "line 3 sets UID" in skipped[2]] == [True] * 3
    assert values["REKALL_BRANCH"] == "beta-next"
    assert values["REKALL_URL"] == "http://127.0.0.1:8000"


def test_a_settings_file_that_is_named_but_missing_stops_the_deploy(tmp_path: Path) -> None:
    code, _, _ = settings(tmp_path, None, REKALL_CONFIG=str(tmp_path / "beta.env"))
    assert code == 1


def test_without_a_settings_file_the_defaults_apply(tmp_path: Path) -> None:
    code, values, _ = settings(tmp_path, None)
    assert code == 0
    assert values["REKALL_BRANCH"] == "main"
    assert values["REKALL_RESTART"] == "systemctl --user restart rekall.service"
    assert values["REKALL_URL"] == "http://127.0.0.1:8000"
