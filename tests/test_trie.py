# AI-generated — to be rewritten by me
import pytest

from index.trie import Trie


@pytest.fixture
def trie():
    t = Trie()
    for word in ["장학금", "장학", "대출", "Current Loans", "current grades", "Course Evaluation", "my courses"]:
        t.insert(word)
    return t


def test_empty_prefix_returns_nothing(trie):
    assert trie.starts_with("") == []
    assert trie.starts_with("   ") == []


def test_empty_trie():
    assert Trie().starts_with("a") == []


def test_unknown_prefix(trie):
    assert trie.starts_with("xyz") == []


def test_case_insensitive_and_ranked_shortest_first(trie):
    assert trie.starts_with("CUR") == ["Current Loans", "current grades"]


def test_full_word_is_its_own_completion(trie):
    assert trie.starts_with("대출") == ["대출"]


@pytest.mark.parametrize("prefix", ["ㅈ", "ㅈㅏ", "ㅈㅏㅇ", "자", "장", "장ㅎ", "장하", "장학"])
def test_korean_jamo_prefixes(trie, prefix):
    assert trie.starts_with(prefix) == ["장학", "장학금"]


def test_limit(trie):
    assert trie.starts_with("c", limit=1) == ["Current Loans"]
    assert trie.starts_with("c", limit=0) == []


def test_duplicate_key_keeps_first_display_text():
    t = Trie()
    t.insert("My Courses")
    t.insert("my courses")
    assert t.starts_with("my") == ["My Courses"]
