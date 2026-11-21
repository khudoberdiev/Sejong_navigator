# AI-generated — to be rewritten by me
"""Hybrid scoring in core.search, with FakeEmbedder (see conftest.py)."""
import pytest

import core
from core import navigator, ranking
from core.data import load_menu_items


def test_search_uses_default_weight():
    assert core.search("my grades", 5) == navigator.search_with_weight("my grades", 5, navigator.SEMANTIC_WEIGHT)


def test_default_weight_is_0_5():
    assert navigator.SEMANTIC_WEIGHT == 0.5


def test_semantic_scores_are_min_max_scaled():
    scores = navigator._semantic_scores("my grades")
    assert len(scores) == len(load_menu_items())
    assert min(scores.values()) == pytest.approx(0.0)
    assert max(scores.values()) == pytest.approx(1.0)


@pytest.mark.parametrize("weight", [0.0, 0.3, 0.7, 1.0])
def test_scores_in_range_and_sorted(weight):
    scores = [r["score"] for r in navigator.search_with_weight("library loans", 50, weight)]
    assert scores == sorted(scores, reverse=True)
    assert all(0 < s <= 1 for s in scores)


def test_score_is_the_weighted_sum_times_the_prior():
    q = "borrowed books"
    lexical = navigator._lexical_scores(navigator.normalize(q))
    semantic = navigator._semantic_scores(q)
    for top in navigator.search_with_weight(q, 5, 0.7):
        if navigator._info()[top["id"]].fold_to != top["id"] or any(
                i.fold_to == top["id"] and k != top["id"] for k, i in navigator._info().items()):
            continue  # folded scores are the best of several items: checked in tests/test_ranking.py
        prior = ranking.prior(navigator._info()[top["id"]], navigator.normalize(q))
        expected = prior * (0.7 * semantic[top["id"]] + 0.3 * lexical[top["id"]])
        assert top["score"] == pytest.approx(expected, abs=1e-4)


def test_weight_one_ignores_lexical():
    q = "library"
    semantic = navigator._semantic_scores(q)
    info = navigator._info()
    folded = ranking.fold(((s, i) for i, s in semantic.items() if s > 0), info)
    expected = sorted((round(s * ranking.prior(info[i], navigator.normalize(q)), 4) for i, s in folded.items()),
                      reverse=True)[:3]
    results = navigator.search_with_weight(q, 3, 1.0)
    assert [r["score"] for r in results] == expected


def test_weight_zero_never_calls_the_embedder():
    class Exploding:
        model_name = "boom"

        def encode(self, texts, kind="query"):
            raise AssertionError("embedder must not be used when weight == 0")

    navigator.use_embedder(Exploding())
    assert navigator.search_with_weight("grades", 3, 0.0)


def test_output_format_unchanged():
    result = core.search("grades", 1)[0]
    assert set(result) == {"id", "site", "name_ko", "name_en", "name_en_site", "parent_id", "url",
                           "selector_desktop", "selector_mobile", "mobile_path_note", "frame",
                           "opens_new_tab", "description", "keywords", "kind", "entry_for", "score"}
