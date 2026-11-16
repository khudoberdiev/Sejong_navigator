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


def test_route_portal_to_current_grades():
    assert ids(core.route("portal.root", "sjpt.grade_current")) == [
        "portal.root",
        "portal.sjpt",
        "sjpt.class_grade",
        "sjpt.grade_eval",
        "sjpt.grade_current",
    ]


def test_route_returns_full_items_like_search_without_score():
    path = core.route("portal.root", "sjpt.grade_current")
    search_fields = set(core.search("grades", 1)[0]) - {"score"}
    assert all(set(step) == search_fields for step in path)
    last = path[-1]
    assert last["name_ko"] == "금학기 성적조회"
    assert last["name_en"] == "Current Semester Grade Inquiry"
    assert last["selector"] == "a[data-menu='grade-current']"
    assert isinstance(last["keywords"], list)


def test_route_steps_follow_parent_links():
    path = core.route("portal.root", "library.loans")
    for parent, child in zip(path, path[1:]):
        assert child["parent_id"] == parent["id"]


def test_route_same_node():
    assert ids(core.route("library.loans", "library.loans")) == ["library.loans"]


def test_route_across_sites_goes_through_portal():
    path = ids(core.route("library.loans", "ecampus.assignments"))
    assert path[0] == "library.loans" and path[-1] == "ecampus.assignments"
    assert "portal.root" in path


def test_route_unknown_id():
    with pytest.raises(KeyError):
        core.route("portal.root", "does.not.exist")


# --------------------------------------------------------------------- search


@pytest.mark.parametrize("query", ["where are my grades?", "baholarim qayerda?", "성적 조회", "grdaes"])
def test_lexical_search_finds_grades(query):
    ids = [r["id"] for r in lexical(query, 3)]
    assert "sjpt.grade_current" in ids


@pytest.mark.parametrize(
    "query, expected",
    [
        ("kitoblarim qayerda", "library.loans"),
        ("borrowed books", "library.loans"),
        ("stipendiya", "sjpt.tuition"),
        ("과제 제출", "ecampus.assignments"),
        ("timetabel", "sjpt.timetable"),  # typo
    ],
)
def test_lexical_search_top_result(query, expected):
    assert lexical(query, 1)[0]["id"] == expected


def test_search_respects_k():
    assert len(core.search("library", 2)) <= 2


def test_search_result_shape():
    result = core.search("grades", 1)[0]
    assert set(result) == {"id", "site", "name_ko", "name_en", "parent_id", "url",
                           "selector", "description", "keywords", "score"}
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
    assert "Current Loans" in core.suggest("Cur")


def test_suggest_korean_jamo():
    assert "장학금" in core.suggest("ㅈㅏㅇ")


def test_suggest_uzbek_keyword():
    assert "baholarim" in core.suggest("baho")


def test_suggest_empty_and_unknown():
    assert core.suggest("") == []
    assert core.suggest("qqqq") == []


def test_suggest_at_most_ten():
    assert len(core.suggest("s")) <= 10
