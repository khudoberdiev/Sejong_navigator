# AI-generated — to be rewritten by me
"""core/ranking.py: kinds, unreachable items, priors, and what they do to search.

Search-order tests use the lexical part only (weight 0): FakeEmbedder (conftest.py) is not a
real model. eval/run_eval.py measures the real one.
"""
import pytest

import core
from core import ranking
from core.data import load_menu_items
from core.models import MenuItem
from core.navigator import _info, normalize, search_with_weight


def lexical(query, k=3):
    return [r["id"] for r in search_with_weight(query, k, 0.0)]


def item(item_id, parent=None, url=None, site=None):
    site = site or item_id.split(".")[0]
    return MenuItem(item_id, site, item_id, item_id, parent, url, "")


# --------------------------------------------------------------------- kinds


def test_kinds_on_a_small_tree():
    items = {i.id: i for i in [
        item("portal.root", url="https://portal.sejong.ac.kr"),
        item("portal.group", "portal.root"),                                                 # no url, children
        item("portal.page", "portal.group", "https://portal.sejong.ac.kr/x"),                # leaf
        item("portal.lib", "portal.group", "https://library.sejong.ac.kr/"),                 # opens the library
        item("library.home", "portal.lib", "https://library.sejong.ac.kr/"),
        item("library.landing", "library.home", "https://library.sejong.ac.kr/use"),        # url + children
        item("library.leaf", "library.landing"),
        item("portal.shortcut", "portal.root", "https://sjpt.sejong.ac.kr/sso"),             # into SJPT, no children
        item("portal.youtube", "portal.root", "https://www.youtube.com/x"),                  # external leaf
    ]}
    info = ranking.classify(items)
    assert {k: (v.kind, v.entry_for) for k, v in info.items()} == {
        "portal.root": ("page", None), "portal.group": ("folder", None), "portal.page": ("page", None),
        "portal.lib": ("entry", "library"), "library.home": ("page", None), "library.landing": ("page", None),
        "library.leaf": ("page", None), "portal.shortcut": ("entry", "sjpt"), "portal.youtube": ("page", None),
    }


def test_kinds_on_the_real_menu_map():
    info = _info()
    assert (info["portal.library"].kind, info["portal.library"].entry_for) == ("entry", "library")
    assert (info["portal.sjpt"].kind, info["portal.sjpt"].entry_for) == ("entry", "sjpt")
    assert info["portal.quick_academic"].kind == "entry"           # the portal's 학사정보 shortcut
    assert info["sjpt.grades_course_evaluation"].kind == "folder"  # 성적 및 강의평가
    assert info["sjpt.grades"].kind == "folder"                    # 성적 (Language Institute)
    assert info["sjpt.current_semester_grades"].kind == "page"
    assert info["library.seat_status_more"].kind == "page"         # a link with children inside libseat
    assert info["sjpt.grades"].secondary == "sjpt.sejong_language_institute"
    assert info["sjpt.current_semester_grades"].secondary is None


def test_items_inside_an_external_system_fold_into_the_link_that_opens_it():
    info = _info()
    assert info["library.libseat_room_status"].fold_to == "library.seat_status_more"
    assert info["library.libseat_seat_map_popup"].fold_to == "library.seat_status_more"
    assert info["library.seat_status_more"].fold_to == "library.seat_status_more"
    for item_id, i in info.items():  # a fold target is always reachable itself
        assert info[i.fold_to].fold_to == i.fold_to, item_id


def test_unreachable_items_never_come_back_from_search():
    for query in ("joy band qilish", "seat map", "reserve seat", "열람실 배정현황"):
        ids = [r["id"] for r in core.search(query, 50)]
        assert not any(i.startswith("library.libseat_") for i in ids), (query, ids)
    assert lexical("seat map", 1) == ["library.seat_status_more"]  # the seat map's own keyword


# --------------------------------------------------------------------- priors


def test_prior_values():
    page = ranking.ItemInfo("page", None, None, "x")
    folder = ranking.ItemInfo("folder", None, None, "x")
    entry = ranking.ItemInfo("entry", "library", None, "x")
    language = ranking.ItemInfo("page", None, "sjpt.sejong_language_institute", "x")
    q = normalize("grades")
    assert ranking.prior(page, q) == 1.0 > ranking.prior(folder, q) > ranking.prior(entry, q)
    assert ranking.prior(language, q) < ranking.prior(folder, q)


@pytest.mark.parametrize("query", ["language center grades", "어학원 성적", "Korean course", "til baholari",
                                   "Sejong Language Institute", "한국어 수업"])
def test_language_institute_is_not_penalized_when_asked_for(query):
    assert ranking.query_names_subtree(normalize(query), "sjpt.sejong_language_institute"), query


@pytest.mark.parametrize("query", ["grades", "my grades", "성적", "baholarim", "until", "tilt"])
def test_language_institute_is_penalized_otherwise(query):
    assert not ranking.query_names_subtree(normalize(query), "sjpt.sejong_language_institute"), query


@pytest.mark.parametrize("query", ["grades", "my grades", "baholarim", "성적", "Grade", "성적조회"])
def test_grades_find_the_real_page_first(query):
    # not 성적 / Grade (Language Institute folder), not 성적 및 강의평가 (folder), not a shortcut
    assert lexical(query, 1) == ["sjpt.current_semester_grades"], lexical(query)


def test_language_institute_grades_still_found_when_asked_for():
    assert lexical("language center grades", 2)[0] in {"sjpt.grade_inquiry", "sjpt.grades"}
    assert lexical("어학원 성적", 3)[0] in {"sjpt.grade_inquiry", "sjpt.grades"}


def test_entry_links_rank_below_pages_with_the_same_words():
    ids = lexical("seat reservation", 5)
    assert "portal.library" not in ids[:1], ids


@pytest.mark.parametrize("query, expected", [
    ("book a room", "library.studyroom_booking"), ("study room", "library.studyroom_booking"),
    ("스터디룸 예약", "library.studyroom_booking"), ("group study", "library.studyroom_booking"),
    ("cinema room", "library.cinemaroom_booking"), ("시네마룸", "library.cinemaroom_booking"),
    ("S-Lounge", "library.slounge_booking"), ("라운지 예약", "library.slounge_booking"),
])
def test_booking_buttons_beat_the_info_pages(query, expected):
    # the GO buttons on library home, not 스터디룸 안내 및 예약 (rules) or 시설이용 (folder)
    assert lexical(query, 1) == [expected], lexical(query)


def test_free_seats_is_seat_status_not_booking():
    assert lexical("free seats", 1) == ["library.seat_status_more"]
    assert lexical("좌석 현황", 1) == ["library.seat_status_more"]
    keywords = {k.lower() for k in load_menu_items()["library.seat_status_more"].keywords}
    assert not any("reserv" in k or "예약" in k or "band" in k for k in keywords), keywords


def test_scores_stay_in_range_and_results_carry_kind():
    results = core.search("grades", 10)
    assert all(0 < r["score"] <= 1 for r in results)
    assert all(r["kind"] in ("page", "folder", "entry") for r in results)
    route = core.route("portal.root", "library.fs_seat")
    assert [s["kind"] for s in route][3] == "entry" and route[3]["entry_for"] == "library"
