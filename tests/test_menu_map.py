# AI-generated — to be rewritten by me
"""Sanity checks on data/menu_map.json, its loader, and scripts/build_menu_map.py."""
import html
import json
import re

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


def test_selectors_do_not_depend_on_the_display_language():
    # The sites have KOR and ENG modes. A Korean attribute value in a selector (it was
    # #gnb a[title="학사정보시스템"]) matches only in Korean mode: in English mode the step
    # was never found. Selectors must use ids, hrefs, classes or language-free codes
    # (SJPT's treenodevalue); the extension tells shared selectors apart by label.
    hangul = re.compile(r"[가-힣ㄱ-ㆎ]")
    for item in load_menu_items().values():
        for selector in (item.selector_desktop, item.selector_mobile):
            assert not (selector and hangul.search(selector)), f"{item.id}: {selector}"


def test_items_sharing_a_selector_have_distinct_labels():
    # Two items with the same selector (portal.sjpt / portal.general_admin) are told apart by
    # their name_ko / name_en_site (extension/shared.js pickCandidate). That needs labels where
    # neither contains the other, in both languages.
    def key(text):
        return " ".join(html.unescape(text or "").split()).lower()

    by_selector = {}
    for item in load_menu_items().values():
        for selector in {item.selector_desktop, item.selector_mobile} - {None}:
            by_selector.setdefault((item.site, selector), []).append(item)
    shared = {sel: items for sel, items in by_selector.items() if len(items) > 1}
    assert ("portal", '#gnb a[href*="doSsoLogin.do"]') in shared
    for (_, selector), items in shared.items():
        for a in items:
            for b in items:
                if a is b:
                    continue
                for x in filter(None, (key(a.name_ko), key(a.name_en_site))):
                    for y in filter(None, (key(b.name_ko), key(b.name_en_site))):
                        assert x not in y and y not in x, f"{selector}: {a.id} {x!r} vs {b.id} {y!r}"


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


# --------------------------------------------------------------------- Problem N


def test_no_url_in_data_carries_a_login_token():
    # libseat links carry ?token=... (a login): never store, log or send one
    for path in sorted((build.ROOT / "data").rglob("*.json")) + [build.EXTENSION_COPY, build.ANSWERS_COPY]:
        assert "token=" not in path.read_text(encoding="utf-8").lower(), path
    for item in load_menu_items().values():
        if item.url and "libseat." in item.url:
            assert "?" not in item.url, item.id  # libseat: no query at all


def test_build_rejects_a_url_with_a_token(tmp_path):
    bad = _raw_item("portal.a")
    bad["url"] = "https://libseat.sejong.ac.kr/mobile/MA/LsroomList.php?token=abc123"
    problems = _problems(tmp_path, [*_entries(), bad])
    assert any("portal.a" in p and "login token" in p for p in problems)


def test_display_labels_never_show_disambiguation_notes():
    notes = re.compile(r"\((home|footer|quick menu|dashboard|libseat|links tab|header|sub-page)\)", re.I)
    for item in load_menu_items().values():
        assert not notes.search(item.label_en), (item.id, item.label_en)
    built = json.loads(build.OUTPUT.read_text(encoding="utf-8"))["items"]
    assert all(i["label_en"] == load_menu_items()[i["id"]].label_en for i in built)
    # the notes stay where they help: name_en, which search uses
    assert load_menu_items()["ecampus.footer_qna"].name_en == "Q&A (footer)"
    assert load_menu_items()["ecampus.footer_qna"].label_en == "Q&A"


def test_display_labels_are_never_doubled():
    doubled = re.compile(r"(?i)\b(\S+(?: \S+)?) \1\b")
    for item in load_menu_items().values():
        assert not doubled.search(item.label_en), (item.id, item.label_en)  # "S-Lounge S-Lounge booking"


def test_booking_items_are_leaves_under_library_home_opening_libseat():
    items = load_menu_items()
    pages = {"library.studyroom_booking": "LsroomList.php", "library.cinemaroom_booking": "LcinemaList.php",
             "library.slounge_booking": "LloungeList.php"}
    # the GO / ↗ button itself, not the card (Chrome agent, 2026-11-21: one match each, no other
    # link in the card has the same href)
    buttons = {"library.studyroom_booking": 'div.reserveStudy > a[href="/relation/studyroom"]',
               "library.cinemaroom_booking": 'div.reserveCinema .moreCon > a[href="/relation/cinemaroom"]',
               "library.slounge_booking": 'div.reserveLounge .moreCon > a[href="/relation/sloungeroom"]'}
    for item_id, page in pages.items():
        item = items[item_id]
        assert item.parent_id == "library.home" and item.opens_new_tab, item_id
        assert item.url == f"https://libseat.sejong.ac.kr/mobile/MA/{page}"
        assert item.selector_desktop == item.selector_mobile == buttons[item_id], item_id
        assert not any(i.parent_id == item_id for i in items.values()), f"{item_id} is not a leaf"
        assert "(" not in item.label_en
    assert not any(i.startswith("library.home_reserve_") for i in items)  # renamed, not duplicated
