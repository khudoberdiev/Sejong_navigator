# AI-generated — to be rewritten by me
"""Extension checks that need no browser.

* extension/shared.js unit tests (tests/js/shared.test.js), run with macOS JavaScriptCore
* a recorded export loads with core's own loader, and route() works on it
* manifest.json points at files that exist and covers the four sites
"""
import json
import re
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
        assert all(i.url or i.selector_desktop for i in items.values())  # old "selector" field still loads
        assert all(i.selector_mobile is None and i.name_en_site is None for i in items.values())
        deepest = max(items.values(), key=lambda i: len(bfs_path(build_graph(items.values()), "portal.root", i.id)))
        path_ids = bfs_path(build_graph(items.values()), "portal.root", deepest.id)
        assert len(path_ids) == 5  # portal → 학사정보시스템 → 수업/성적 → 성적 및 강의평가 → Current Semester…
    finally:
        monkeypatch.delenv("SEJONG_MENU_MAP")
        load_menu_items.cache_clear()


def test_manifest_files_exist_and_cover_sites():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["manifest_version"] == 3
    assert "default_popup" not in manifest["action"]  # the UI lives in the side panel
    assert "sidePanel" in manifest["permissions"]
    referenced = [manifest["background"]["service_worker"], manifest["side_panel"]["default_path"]]
    for script in manifest["content_scripts"]:
        referenced += script["js"] + script.get("css", [])
        for host in ["portal", "sjpt", "ecampus", "library"]:
            assert f"*://{host}.sejong.ac.kr/*" in script["matches"]
        assert script["all_frames"] is True  # menus and pop-ups inside iframes
    for name in referenced:
        assert (EXT / name).is_file(), name


def test_page_hook_runs_in_page_world_before_site_scripts():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    hook = next(s for s in manifest["content_scripts"] if s["js"] == ["page_hook.js"])
    assert hook["world"] == "MAIN" and hook["run_at"] == "document_start"
    text = (EXT / "page_hook.js").read_text(encoding="utf-8")
    assert "fetch(" not in text and "XMLHttpRequest" not in text  # it only reports to content.js


def test_bundled_menu_map_is_in_sync():
    bundled = EXT / "data" / "menu_map.json"
    source = ROOT / "data" / "menu_map.json"
    assert bundled.read_bytes() == source.read_bytes(), "run: .venv/bin/python scripts/sync_extension_data.py"


def test_translation_never_uses_a_public_service():
    for js in EXT.glob("*.js"):
        text = js.read_text(encoding="utf-8")
        for host in ("translate.googleapis", "translate.google", "api.mymemory", "libretranslate.com",
                     "deepl.com", "papago"):
            assert host not in text, f"{js.name} mentions {host}"
    assert 'TRANSLATE_URL: ""' in (EXT / "config.js").read_text(encoding="utf-8")  # off unless self-hosted


def test_backend_url_lives_only_in_config():
    for js in EXT.glob("*.js"):
        text = js.read_text(encoding="utf-8")
        if js.name != "config.js":
            assert "127.0.0.1" not in text and "localhost" not in text, js.name
    assert 'BACKEND_URL: "http://127.0.0.1:8000"' in (EXT / "config.js").read_text(encoding="utf-8")


def test_manifest_can_inject_the_content_script():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    assert "scripting" in manifest["permissions"]  # chrome.scripting.executeScript into already-open tabs


def test_injected_files_match_the_manifest_content_scripts():
    # background.js injects into tabs that were open before the extension (re)loaded: it must
    # inject exactly what the manifest injects into new pages.
    text = (EXT / "background.js").read_text(encoding="utf-8")
    match = re.search(r"const CONTENT_FILES = (\{.*?\});", text)
    assert match, "CONTENT_FILES not found in background.js"
    files = json.loads(re.sub(r"(\w+):", r'"\1":', match.group(1)))
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    main = next(s for s in manifest["content_scripts"] if s.get("world") == "MAIN")
    isolated = next(s for s in manifest["content_scripts"] if s.get("world") != "MAIN")
    assert files == {"css": isolated["css"], "isolated": isolated["js"], "main": main["js"]}


def _css_rules(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return re.findall(r"([^{}]+)\{([^{}]*)\}", css)


def test_highlight_frame_draws_nothing_outside_itself():
    css = (EXT / "content.css").read_text(encoding="utf-8")
    assert css.startswith("/* AI-generated")
    rules = [(sel.strip(), body) for sel, body in _css_rules(css)]
    frame = [(sel, body) for sel, body in rules if "sejong-nav-frame" in sel]
    assert frame, "no sejong-nav-frame rules"
    for selector, body in frame:
        for value in re.findall(r"box-shadow\s*:\s*([^;]+);", body):
            # split the shadow list on commas outside parentheses (rgba(...), calc(...))
            layers = re.split(r",(?![^(]*\))", value)
            assert all(layer.strip().startswith("inset") for layer in layers), f"{selector}: outer shadow {layer!r}"
        assert not re.search(r"\boutline-offset\s*:\s*[1-9]", body), f"{selector}: outline pushed outward"
        assert not re.search(r"\boutline\s*:\s*([2-9]|\d{2,})px", body), f"{selector}: outline wider than 1px"
    frame_rule = dict(frame)["sejong-nav-frame"]
    assert "pointer-events: none !important" in frame_rule and "position: fixed !important" in frame_rule
    assert "3px solid #d97757" in frame_rule.lower()
    assert "prefers-reduced-motion" in css
    # the old design is gone: no label bubble, no class on the site's own element
    assert "sejong-nav-pointer" not in css and "sejong-nav-highlight" not in css


def test_content_script_does_not_restyle_the_site():
    text = (EXT / "content.js").read_text(encoding="utf-8")
    assert "classList.add(HIGHLIGHT" not in text and 'tip.id = "sejong-nav-pointer"' not in text
    assert 'createElement(FRAME_TAG)' in text
