# AI-generated — to be rewritten by me
"""Sanity checks on data/menu_map.json and its loader."""
import pytest

from core.data import load_menu_items
from core.models import SITES


def test_loads_and_has_items():
    items = load_menu_items()
    assert 15 <= len(items) <= 200


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


def test_every_example_item_has_keywords():
    # The example data fills keywords everywhere. Real data may leave them out.
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


def test_every_item_is_clickable_or_reachable_by_url():
    for item in load_menu_items().values():
        assert item.url or item.selector, f"{item.id} has neither url nor selector"
