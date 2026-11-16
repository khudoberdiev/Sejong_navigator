# AI-generated — to be rewritten by me
"""Prefix tree (trie) used for autocomplete in core.suggest.

Keys are stored in normalized form (see index/text.py), so matching ignores
case and punctuation, and Korean matches at jamo level: "ㅈㅏㅇ" finds "장학금".

Ranking rule for starts_with():
  1. Shorter completions first: the closest to what is already typed.
  2. Then alphabetical (by normalized key), so the order never changes.
"""
from __future__ import annotations

from index.text import normalize


class _Node:
    __slots__ = ("children", "word")

    def __init__(self) -> None:
        self.children: dict[str, _Node] = {}
        self.word: str | None = None  # original text, set only where a stored word ends


class Trie:
    """A character trie of normalized words. Each word keeps its original display text."""

    def __init__(self) -> None:
        """Create an empty trie."""
        self._root = _Node()

    def insert(self, word: str) -> None:
        """Add a word. Takes O(L) time, where L = len(normalize(word)).

        If two words normalize to the same key ("My Courses" / "my courses"),
        the first one inserted is kept as the display text.
        """
        key = normalize(word)
        if not key:
            return
        node = self._root
        for ch in key:
            node = node.children.setdefault(ch, _Node())
        if node.word is None:
            node.word = word

    def starts_with(self, prefix: str, limit: int = 10) -> list[str]:
        """Return up to ``limit`` stored words whose key begins with the normalized prefix.

        Steps:
          1. Walk down one node per character of the prefix: O(P).
          2. Visit the whole subtree under that node with an iterative DFS and
             collect (key, word) pairs: O(N), where N = nodes in the subtree.
          3. Sort by the ranking rule in the module docstring: O(M log M), M = words found.

        An empty prefix, or one that is not in the trie, returns [].
        """
        key = normalize(prefix)
        if not key or limit <= 0:
            return []

        node = self._root
        for ch in key:
            node = node.children.get(ch)
            if node is None:
                return []

        found: list[tuple[str, str]] = []
        stack = [(node, key)]
        while stack:
            current, current_key = stack.pop()
            if current.word is not None:
                found.append((current_key, current.word))
            for ch, child in current.children.items():
                stack.append((child, current_key + ch))

        found.sort(key=lambda pair: (len(pair[0]), pair[0]))
        return [word for _, word in found[:limit]]
