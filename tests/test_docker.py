# AI-generated — to be rewritten by me
"""Static checks for Dockerfile / docker-compose.yml (Docker itself is not needed)."""
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")


def _copied_dirs():
    return [src for src, _ in re.findall(r"^COPY (\S+) (\S+)$", DOCKERFILE, re.M) if (ROOT / src).is_dir()]


def test_copy_sources_exist_and_skip_private_folders():
    for src, _ in re.findall(r"^COPY (\S+) (\S+)$", DOCKERFILE, re.M):
        assert (ROOT / src).exists(), src
    copied = set(_copied_dirs())
    assert {"core", "index", "ml", "api", "server_ai", "data"} <= copied
    assert "server" not in copied and "tests" not in copied


def test_image_file_set_is_self_contained(tmp_path):
    """Exactly the folders the image gets must be enough to import both servers."""
    for name in _copied_dirs():
        shutil.copytree(ROOT / name, tmp_path / name, ignore=shutil.ignore_patterns("__pycache__"))
    code = ("import api.main, server_ai, core; "
            "assert core.route('portal.root', 'sjpt.course_evaluation')[-1]['id'] == 'sjpt.course_evaluation'; print('ok')")
    proc = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, capture_output=True, text=True,
                          env={"PATH": "/usr/bin:/bin", "PYTHONPATH": str(tmp_path)}, timeout=120)
    assert proc.returncode == 0 and proc.stdout.strip().endswith("ok"), proc.stderr[-2000:]


def test_start_script_warms_up_then_runs_uvicorn():
    script = (ROOT / "docker" / "start.sh").read_text(encoding="utf-8")
    assert script.startswith("#!/bin/sh") and "core.search(" in script
    assert "exec uvicorn api.main:app --host 0.0.0.0 --port 8000" in script


def test_compose_services_and_local_only_ports():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    services = compose["services"]
    assert set(services) == {"api", "server_ai", "libretranslate"}
    assert services["api"]["ports"] == ["127.0.0.1:8000:8000"]   # same URL as config.js
    assert services["server_ai"]["profiles"] == ["tcp"]
    assert services["libretranslate"]["profiles"] == ["translate"]
    for service in services.values():
        for port in service["ports"]:
            assert port.startswith("127.0.0.1:"), port
    assert "./data:/app/data:ro" in services["api"]["volumes"]
    assert set(compose["volumes"]) == {"model-cache", "translate-models"}


def test_dockerignore_keeps_secrets_and_venv_out():
    ignored = (ROOT / ".dockerignore").read_text(encoding="utf-8").split()
    for entry in (".venv/", ".env", ".git/", "models/", "server/"):
        assert entry in ignored
