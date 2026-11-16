# AI-generated — to be rewritten by me
import random

from index.topk import top_k


def test_empty_input():
    assert top_k([], 3) == []


def test_k_zero_or_negative():
    assert top_k([(1.0, "a")], 0) == []
    assert top_k([(1.0, "a")], -1) == []


def test_best_first():
    pairs = [(0.2, "a"), (0.9, "b"), (0.5, "c"), (0.7, "d")]
    assert top_k(pairs, 2) == [(0.9, "b"), (0.7, "d")]


def test_k_larger_than_input_returns_all_sorted():
    assert top_k([(1, "x"), (3, "y"), (2, "z")], 10) == [(3, "y"), (2, "z"), (1, "x")]


def test_ties_keep_earlier_input():
    pairs = [(1.0, "first"), (1.0, "second"), (1.0, "third")]
    assert top_k(pairs, 2) == [(1.0, "first"), (1.0, "second")]


def test_items_are_never_compared():
    # dicts cannot be compared with <; this must not raise
    assert top_k([(1.0, {"id": 1}), (1.0, {"id": 2})], 1) == [(1.0, {"id": 1})]


def test_matches_sorting():
    rng = random.Random(0)
    pairs = [(rng.randint(0, 20), i) for i in range(200)]
    expected = sorted(pairs, key=lambda p: (-p[0], p[1]))[:7]
    assert top_k(pairs, 7) == expected
