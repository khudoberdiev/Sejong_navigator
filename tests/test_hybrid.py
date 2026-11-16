# AI-generated — to be rewritten by me
"""Hybrid scoring in core.search, with FakeEmbedder (see conftest.py)."""
import pytest

import core
from core import navigator


def test_search_uses_default_weight():
    assert core.search("my grades", 5) == navigator.search_with_weight("my grades", 5, navigator.SEMANTIC_WEIGHT)


def test_default_weight_is_0_5():
    assert navigator.SEMANTIC_WEIGHT == 0.5


def test_semantic_scores_are_min_max_scaled():
    scores = navigator._semantic_scores("my grades")
    assert len(scores) == 19
    assert min(scores.values()) == pytest.approx(0.0)
    assert max(scores.values()) == pytest.approx(1.0)


@pytest.mark.parametrize("weight", [0.0, 0.3, 0.7, 1.0])
def test_scores_in_range_and_sorted(weight):
    scores = [r["score"] for r in navigator.search_with_weight("library loans", 19, weight)]
    assert scores == sorted(scores, reverse=True)
    assert all(0 < s <= 1 for s in scores)


def test_score_is_the_weighted_sum():
    q = "borrowed books"
    lexical = navigator._lexical_scores(navigator.normalize(q))
    semantic = navigator._semantic_scores(q)
    top = navigator.search_with_weight(q, 1, 0.7)[0]
    expected = 0.7 * semantic[top["id"]] + 0.3 * lexical[top["id"]]
    assert top["score"] == pytest.approx(expected, abs=1e-4)


def test_weight_one_ignores_lexical():
    q = "library"
    semantic = navigator._semantic_scores(q)
    results = navigator.search_with_weight(q, 3, 1.0)
    assert [r["score"] for r in results] == [round(v, 4) for v in sorted(semantic.values(), reverse=True)[:3]]


def test_weight_zero_never_calls_the_embedder():
    class Exploding:
        model_name = "boom"

        def encode(self, texts, kind="query"):
            raise AssertionError("embedder must not be used when weight == 0")

    navigator.use_embedder(Exploding())
    assert navigator.search_with_weight("grades", 3, 0.0)


def test_output_format_unchanged():
    result = core.search("grades", 1)[0]
    assert set(result) == {"id", "site", "name_ko", "name_en", "parent_id", "url",
                           "selector", "description", "keywords", "score"}
