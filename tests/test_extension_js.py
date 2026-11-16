# AI-generated — to be rewritten by me
"""Extension checks that need no browser.

* extension/shared.js unit tests (tests/js/shared.test.js), run with macOS JavaScriptCore
* a recorded export loads with core's own loader, and route() works on it
* manifest.json points at files that exist and covers the four sites
"""
import json
import subprocess
from pathlib import Path

import pytest

from core.data import load_menu_items
from index.graph import bfs_path, build_graph

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc")
needs_jsc = pytest.mark.skipif(not JSC.exists(), reason="needs macOS JavaScriptCore (jsc)")


@pytest.fixture(scope="module")
def js_run(tmp_path_factory):
    script = tmp_path_factory.mktemp("js") / "run.js"
    script.write_text(
        (EXT / "shared.js").read_text(encoding="utf-8") + "\n"
        + (ROOT / "tests" / "js" / "shared.test.js").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    proc = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    lines = dict(line.split(" ", 1) for line in proc.stdout.splitlines()
                 if line.startswith(("RESULT ", "EXPORT ")))
    return json.loads(lines["RESULT"]), json.loads(lines["EXPORT"])


@needs_jsc
def test_shared_js_unit_tests(js_run):
    result, _ = js_run
    assert result["failures"] == []
    assert result["passed"] >= 20


@needs_jsc
def test_recorded_export_loads_in_core(js_run, tmp_path, monkeypatch):
    _, exported = js_run
    path = tmp_path / "menu_map.recorded.json"
    path.write_text(json.dumps(exported, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("SEJONG_MENU_MAP", str(path))
    load_menu_items.cache_clear()
    try:
        items = load_menu_items()
        assert [i.id for i in items.values() if i.parent_id is None] == ["portal.root"]
        assert all(i.keywords == () for i in items.values())
        assert all(i.url or i.selector for i in items.values())
        deepest = max(items.values(), key=lambda i: len(bfs_path(build_graph(items.values()), "portal.root", i.id)))
        path_ids = bfs_path(build_graph(items.values()), "portal.root", deepest.id)
        assert len(path_ids) == 5  # portal → 학사정보시스템 → 수업/성적 → 성적 및 강의평가 → Current Semester…
    finally:
        monkeypatch.delenv("SEJONG_MENU_MAP")
        load_menu_items.cache_clear()


def test_manifest_files_exist_and_cover_sites():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == 3
    referenced = [manifest["background"]["service_worker"], manifest["action"]["default_popup"]]
    for script in manifest["content_scripts"]:
        referenced += script["js"] + script["css"]
    for name in referenced:
        assert (EXT / name).is_file(), name
    matches = manifest["content_scripts"][0]["matches"]
    for host in ["portal", "sjpt", "ecampus", "library"]:
        assert f"*://{host}.sejong.ac.kr/*" in matches
    assert manifest["content_scripts"][0]["all_frames"] is True


def test_backend_url_lives_only_in_config():
    for js in EXT.glob("*.js"):
        text = js.read_text(encoding="utf-8")
        if js.name != "config.js":
            assert "127.0.0.1" not in text and "localhost" not in text, js.name
    assert 'BACKEND_URL: "http://127.0.0.1:8000"' in (EXT / "config.js").read_text(encoding="utf-8")
