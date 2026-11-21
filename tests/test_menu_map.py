# AI-generated — to be rewritten by me
"""Sanity checks on data/menu_map.json, its loader, and scripts/build_menu_map.py."""
import json

import pytest

from scripts import build_menu_map as build

from core.data import load_menu_items
from core.models import SITES


def test_loads_and_has_items():
    items = load_menu_items()
    assert 150 <= len(items) <= 500


def test_sites_are_valid():
    assert all(item.site in SITES for item in load_menu_items().values())


def test_exactly_one_root_and_no_cycles():
    items = load_menu_items()
    roots = [i for i in items.values() if i.parent_id is None]
    assert len(roots) == 1
    for item in items.values():
        seen = set()
        node = item
        while node.parent_id is not None:
            assert node.id not in seen, f"cycle at {node.id}"
            seen.add(node.id)
            node = items[node.parent_id]


def test_keywords_are_clean_strings():
    for item in load_menu_items().values():
        assert isinstance(item.keywords, tuple)
        for kw in item.keywords:
            assert kw == kw.strip() and kw, f"{item.id}: bad keyword {kw!r}"
        assert len(set(item.keywords)) == len(item.keywords), f"{item.id}: duplicate keywords"


def test_every_item_has_keywords():
    # The recorded data fills keywords everywhere. A hand-made map may leave them out.
    assert all(item.keywords for item in load_menu_items().values())


def test_keywords_are_optional(tmp_path, monkeypatch):
    path = tmp_path / "map.json"
    path.write_text(
        '{"items": [{"id": "r", "site": "portal", "name_ko": "포털", "name_en": "Portal",'
        ' "parent_id": null, "url": "https://x", "selector": null, "description": ""}]}',
        encoding="utf-8",
    )
    monkeypatch.setenv("SEJONG_MENU_MAP", str(path))
    load_menu_items.cache_clear()
    try:
        assert load_menu_items()["r"].keywords == ()
    finally:
        monkeypatch.delenv("SEJONG_MENU_MAP")
        load_menu_items.cache_clear()


def test_bad_keywords_are_rejected(tmp_path, monkeypatch):
    path = tmp_path / "map.json"
    path.write_text(
        '{"items": [{"id": "r", "site": "portal", "name_ko": "포털", "name_en": "Portal",'
        ' "parent_id": null, "url": null, "selector": null, "description": "",'
        ' "keywords": "not a list"}]}',
        encoding="utf-8",
    )
    monkeypatch.setenv("SEJONG_MENU_MAP", str(path))
    load_menu_items.cache_clear()
    try:
        with pytest.raises(ValueError):
            load_menu_items()
    finally:
        monkeypatch.delenv("SEJONG_MENU_MAP")
        load_menu_items.cache_clear()


def test_every_item_is_findable_on_the_page():
    # A selector for at least one layout, or (both null) a label the extension can match by text.
    for item in load_menu_items().values():
        assert item.selector_desktop or item.selector_mobile or item.name_ko.strip(), item.id


def test_old_format_with_a_single_selector_still_loads(tmp_path, monkeypatch):
    path = tmp_path / "map.json"
    path.write_text(json.dumps({"items": [
        {"id": "r", "site": "portal", "name_ko": "포털", "name_en": "Portal", "parent_id": None,
         "url": None, "selector": "#old", "description": ""}]}), encoding="utf-8")
    monkeypatch.setenv("SEJONG_MENU_MAP", str(path))
    load_menu_items.cache_clear()
    try:
        item = load_menu_items()["r"]
        assert (item.selector_desktop, item.selector_mobile, item.name_en_site, item.opens_new_tab) == \
            ("#old", None, None, False)
    finally:
        monkeypatch.delenv("SEJONG_MENU_MAP")
        load_menu_items.cache_clear()


def test_site_label_is_html_decoded_for_search():
    item = load_menu_items()["portal.academic_qna"]
    assert item.name_en_site == "Academic Affairs Q&#38;A"  # kept exactly as recorded
    assert item.site_label_en == "Academic Affairs Q&A"
    assert "Academic Affairs Q&A" in item.search_terms()


# --------------------------------------------------------------------- build script


def test_menu_map_is_the_build_output():
    items, _ = build.build()
    expected = build.render(items)
    assert (build.OUTPUT).read_text(encoding="utf-8") == expected, "run: .venv/bin/python scripts/build_menu_map.py"


def test_build_links_sites_through_their_entry_points():
    items, summary = build.build()
    by_id = {i["id"]: i for i in items}
    assert items[0]["id"] == build.ROOT_ID
    assert [i["id"] for i in items if i["parent_id"] is None] == [build.ROOT_ID]
    assert by_id["sjpt.self_stud"]["parent_id"] == "portal.sjpt"
    assert by_id["sjpt.st"]["parent_id"] == "portal.sjpt"
    assert by_id["portal.info_system"]["parent_id"] == build.ROOT_ID
    for item in items:
        parent = by_id.get(item["parent_id"])
        if parent and parent["site"] != item["site"]:
            assert parent["id"] == build.ENTRY_POINTS[item["site"]], item["id"]
    assert summary["per_site"]["portal"] == 63 and summary["per_site"]["sjpt"] == 92


def _raw_item(item_id, parent=None, site="portal"):
    return {"id": item_id, "site": site, "name_ko": "가", "name_en": "A", "name_en_site": None,
            "parent_id": parent, "url": None, "selector_desktop": None, "selector_mobile": None,
            "mobile_path_note": None, "frame": None, "opens_new_tab": False, "description": "", "keywords": []}


def _entries():
    return [_raw_item(entry) for entry in build.ENTRY_POINTS.values()]


def _problems(tmp_path, *files):
    for number, items in enumerate(files):
        (tmp_path / f"{number}.json").write_text(json.dumps(items), encoding="utf-8")
    with pytest.raises(build.MenuMapError) as error:
        build.build(tmp_path)
    return error.value.problems


def test_build_rejects_duplicate_ids_across_files(tmp_path):
    problems = _problems(tmp_path, [_raw_item("portal.a")], [_raw_item("portal.a")])
    assert any("duplicate id 'portal.a'" in p for p in problems)


def test_build_rejects_missing_parent(tmp_path):
    problems = _problems(tmp_path, [*_entries(), _raw_item("portal.a", parent="portal.gone")])
    assert any("parent_id 'portal.gone' does not exist" in p for p in problems)


def test_build_rejects_cycles(tmp_path):
    problems = _problems(tmp_path, [*_entries(), _raw_item("portal.a", "portal.b"), _raw_item("portal.b", "portal.a")])
    assert "cycle: portal.a -> portal.b -> portal.a" in problems


def test_build_rejects_links_that_skip_the_entry_point(tmp_path):
    problems = _problems(tmp_path, [*_entries(), _raw_item("portal.other"),
                                    _raw_item("sjpt.x", parent="portal.other", site="sjpt")])
    assert any("sjpt.x" in p and "ENTRY_POINTS" in p for p in problems)


def test_build_rejects_bad_fields(tmp_path):
    bad = _raw_item("portal.a")
    bad["opens_new_tab"] = "yes"
    bad["selector"] = "#old"
    del bad["frame"]
    problems = _problems(tmp_path, [bad])
    assert any("missing fields ['frame']" in p for p in problems)
    assert any("unknown fields ['selector']" in p for p in problems)
    assert any("opens_new_tab has type str" in p for p in problems)


def test_find_cycles_reports_each_cycle_once():
    items = {"a": {"parent_id": "b"}, "b": {"parent_id": "a"}, "c": {"parent_id": "a"}, "d": {"parent_id": None}}
    assert build.find_cycles(items) == [["a", "b", "a"]]
