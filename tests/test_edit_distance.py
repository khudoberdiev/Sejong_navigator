# AI-generated — to be rewritten by me
import pytest

from index.edit_distance import levenshtein, similarity


@pytest.mark.parametrize(
    "a, b, expected",
    [
        ("", "", 0),
        ("", "abc", 3),
        ("abc", "", 3),
        ("same", "same", 0),
        ("kitten", "sitting", 3),
        ("grdaes", "grades", 2),   # swapped letters cost 2 in plain Levenshtein
        ("grads", "grades", 1),    # one missing letter
        ("성적", "성젹", 1),
    ],
)
def test_levenshtein(a, b, expected):
    assert levenshtein(a, b) == expected


def test_levenshtein_is_symmetric():
    assert levenshtein("library", "libary") == levenshtein("libary", "library") == 1


def test_similarity_bounds():
    assert similarity("", "") == 1.0
    assert similarity("abc", "abc") == 1.0
    assert similarity("abc", "xyz") == 0.0
    assert similarity("grdaes", "grades") == pytest.approx(1 - 2 / 6)
