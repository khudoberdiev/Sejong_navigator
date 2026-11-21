# AI-generated — to be rewritten by me
"""Expected behaviour of core.search / route / suggest on the real menu map.

These run with FakeEmbedder (see conftest.py), so tests about WHICH item is
found use the lexical part only (weight 0). Real-model quality is checked in
tests/test_ml_slow.py and eval/.
"""
import pytest

import core
from core.navigator import search_with_weight


def lexical(query, k):
    return search_with_weight(query, k, 0.0)

# --------------------------------------------------------------------- route


def ids(path):
    return [step["id"] for step in path]


GRADES_ROUTE = [
    "portal.root",
    "portal.info_system",
    "portal.integrated_info",
    "portal.sjpt",
    "sjpt.self_stud",
    "sjpt.class_grade",
    "sjpt.grades_course_evaluation",
    "sjpt.current_semester_grades",
]


def test_route_portal_to_current_grades():
    assert ids(core.route("portal.root", "sjpt.current_semester_grades")) == GRADES_ROUTE


def test_route_returns_full_items_like_search_without_score():
    path = core.route("portal.root", "sjpt.current_semester_grades")
    search_fields = set(core.search("grades", 1)[0]) - {"score"}
    assert all(set(step) == search_fields for step in path)
    last = path[-1]
    assert last["name_ko"] == "당학기성적조회"
    assert last["name_en"] == "Current Semester Grades"
    assert last["name_en_site"] == "Current Semester Grade inquiry"
    assert 'treenodevalue="SELF_STUDSELF_SUB_30SCH_SUG05_STUDSugRecordNowQ"' in last["selector_desktop"]
    assert last["selector_mobile"] is None
    assert last["opens_new_tab"] is False
    assert path[3]["id"] == "portal.sjpt" and path[3]["opens_new_tab"] is True
    assert isinstance(last["keywords"], list)


def test_route_steps_follow_parent_links():
    path = core.route("portal.root", "ecampus.my_courses")
    for parent, child in zip(path, path[1:]):
        assert child["parent_id"] == parent["id"]


def test_route_same_node():
    assert ids(core.route("sjpt.course_evaluation", "sjpt.course_evaluation")) == ["sjpt.course_evaluation"]


def test_route_across_sites_goes_through_portal():
    path = ids(core.route("ecampus.my_courses", "sjpt.current_semester_grades"))
    assert path[0] == "ecampus.my_courses" and path[-1] == "sjpt.current_semester_grades"
    assert {"portal.ecampus", "portal.root", "portal.sjpt"} <= set(path)


@pytest.mark.parametrize("site, entry", [("sjpt", "portal.sjpt"), ("ecampus", "portal.ecampus"),
                                         ("library", "portal.library")])
def test_every_route_from_the_portal_enters_through_the_entry_point(site, entry):
    from core.data import load_menu_items

    items = load_menu_items()
    portal = [i for i in items if items[i].site == "portal"]
    for target in (i for i in items if items[i].site == site):
        for start in portal:
            path = ids(core.route(start, target))
            assert path, (start, target)
            assert entry in path, f"{start} -> {target} skips {entry}: {path}"


def test_route_unknown_id():
    with pytest.raises(KeyError):
        core.route("portal.root", "does.not.exist")


# --------------------------------------------------------------------- search


# Uzbek keyword + suffix, Korean with extra spaces, the site's English label (ENG mode), typos.
@pytest.mark.parametrize("query", ["joriy baholarim", "당학기 성적 조회", "Current Semester Grade inquiry",
                                   "curent semester grdes"])
def test_lexical_search_finds_current_grades(query):
    ids = [r["id"] for r in lexical(query, 3)]
    assert "sjpt.current_semester_grades" in ids


@pytest.mark.parametrize(
    "query, expected",
    [
        ("joriy baholar qayerda", "sjpt.current_semester_grades"),   # Uzbek keyword in a sentence
        ("Grade History Inquiry", "sjpt.completed_grades_inquiry"),  # only in name_en_site
        ("Academic Affairs Q&A", "portal.academic_qna"),             # name_en_site has "Q&#38;A"
        ("stipendiya", "portal.scholarships"),
        ("curriculm inquiry", "sjpt.curriculum_inquiry"),            # typo
    ],
)
def test_lexical_search_top_result(query, expected):
    assert lexical(query, 1)[0]["id"] == expected


def test_search_respects_k():
    assert len(core.search("library", 2)) <= 2


def test_search_result_shape():
    result = core.search("grades", 1)[0]
    assert set(result) == {"id", "site", "name_ko", "name_en", "name_en_site", "parent_id", "url",
                           "selector_desktop", "selector_mobile", "mobile_path_note", "frame",
                           "opens_new_tab", "description", "keywords", "kind", "entry_for", "score"}
    assert isinstance(result["keywords"], list)
    assert 0 < result["score"] <= 1


def test_search_sorted_best_first():
    scores = [r["score"] for r in core.search("grades", 10)]
    assert scores == sorted(scores, reverse=True)


def test_lexical_search_no_match():
    assert lexical("zzzzqqqq", 5) == []


@pytest.mark.parametrize("query, k", [("", 3), ("  ?! ", 3), ("grades", 0)])
def test_search_bad_arguments(query, k):
    with pytest.raises(ValueError):
        core.search(query, k)


@pytest.mark.parametrize("weight", [-0.1, 1.5])
def test_search_bad_weight(weight):
    with pytest.raises(ValueError):
        search_with_weight("grades", 3, weight)


# --------------------------------------------------------------------- suggest


def test_suggest_prefix():
    assert "Current Semester Grades" in core.suggest("Cur")


def test_suggest_includes_site_english_label_decoded():
    assert "Grade History Inquiry" in core.suggest("Grade Hist")    # name_en_site only
    assert core.suggest("Academic Affairs") == ["Academic Affairs Q&A"]  # not "Q&#38;A"


def test_suggest_korean_jamo():
    assert "장학금" in core.suggest("ㅈㅏㅇ")


def test_suggest_uzbek_keyword():
    assert "baholarim" in core.suggest("baho")


def test_suggest_empty_and_unknown():
    assert core.suggest("") == []
    assert core.suggest("qqqq") == []


def test_suggest_at_most_ten():
    assert len(core.suggest("s")) <= 10
