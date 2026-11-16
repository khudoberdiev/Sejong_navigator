# AI-generated — to be rewritten by me
"""The three public functions: search, route, suggest.

Rules every implementation must follow, so both servers return the same output:
  * Return only plain JSON-serialisable values (str, int, float, list, dict, None).
  * Be deterministic: same input and same data give the same output, in the same order.
  * Never do HTTP or socket work here. That is the servers' job.
  * Error convention, which the servers turn into HTTP status codes:
      ValueError  -> 400 Bad Request   (bad argument, e.g. k < 1 or an empty query)
      KeyError    -> 404 Not Found     (unknown menu item id)
      NotImplementedError -> 501       (only while something is still a stub)

The indexes are built once, on first use, and cached. Call ``reset_caches()``
after changing the menu map at runtime (tests use it too).

Settings (environment variables):
  SEJONG_SEMANTIC_WEIGHT  w in the hybrid score, default 0.5 (0 = lexical only)
  SEJONG_CACHE_DIR        where item vectors are cached, default <project>/.cache/embeddings
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from core.data import load_menu_items
from core.models import MenuItem
from index.edit_distance import similarity
from index.graph import bfs_path, build_graph
from index.text import normalize
from index.topk import top_k
from index.trie import Trie
from ml.embedder import Embedder
from ml.vector_index import VectorIndex

SUGGEST_LIMIT = 10
MIN_SIMILARITY = 0.6   # fuzzy matches below this count as no match
MIN_EXACT_LEN = 2      # shorter normalized terms are ignored for exact matching
MIN_FUZZY_LEN = 3      # shorter normalized terms are never matched fuzzily
SEMANTIC_WEIGHT = float(os.environ.get("SEJONG_SEMANTIC_WEIGHT", "0.5"))
DEFAULT_CACHE_DIR = Path(os.environ.get(
    "SEJONG_CACHE_DIR", Path(__file__).resolve().parent.parent / ".cache" / "embeddings"))

# Which embedder the semantic part uses. None = the real model (ml.embedder.Embedder).
# Tests swap in ml.fake_embedder.FakeEmbedder with use_embedder().
_embedder = None
_cache_dir: Path | None = DEFAULT_CACHE_DIR


# ---------------------------------------------------------------- cached indexes

@lru_cache(maxsize=1)
def _graph() -> dict[str, list[str]]:
    return build_graph(load_menu_items().values())


@lru_cache(maxsize=1)
def _trie() -> Trie:
    trie = Trie()
    items = sorted(load_menu_items().values(), key=lambda i: i.id)
    for item in items:  # names first, so a name wins over an identical keyword
        trie.insert(item.name_ko)
        trie.insert(item.name_en)
    for item in items:
        for keyword in item.keywords:
            trie.insert(keyword)
    return trie


@lru_cache(maxsize=1)
def _search_terms() -> list[tuple[MenuItem, list[str]]]:
    """[(item, [normalized terms])], sorted by id. Ties in search are broken by this order."""
    result = []
    for item in sorted(load_menu_items().values(), key=lambda i: i.id):
        terms = [normalize(t) for t in item.search_terms()]
        result.append((item, [t for t in terms if t]))
    return result


@lru_cache(maxsize=1)
def _vector_index() -> VectorIndex:
    index = VectorIndex(_embedder or Embedder(), cache_dir=_cache_dir)
    index.build(sorted(load_menu_items().values(), key=lambda i: i.id))
    return index


def use_embedder(embedder, cache_dir: Path | None = None) -> None:
    """Switch the embedder used by search(). None goes back to the real model
    with the default disk cache. A custom embedder gets ``cache_dir`` (None = no disk cache)."""
    global _embedder, _cache_dir
    _embedder = embedder
    _cache_dir = DEFAULT_CACHE_DIR if embedder is None else cache_dir
    _vector_index.cache_clear()


def reset_caches() -> None:
    """Forget the loaded menu map and every index built from it."""
    for cached in (load_menu_items, _graph, _trie, _search_terms, _vector_index):
        cached.cache_clear()


# ---------------------------------------------------------------- lexical scoring

def _term_score(term: str, query: str, query_tokens: list[str]) -> float:
    """How well one normalized term matches the normalized query, in [0, 1].

    The score is "how much of the query this term explains":
      * Exact: the term appears in the query starting at a word boundary
        ("my grades" in "where are my grades"; "baholarim" in "baholarimni").
        Score = len(term) / len(query).
      * Fuzzy: compare the term with every run of n and n+1 neighbouring query
        words (n = words in the term; n+1 covers spacing differences like
        "성적 조회" vs "성적조회"). If similarity >= MIN_SIMILARITY:
        score = similarity * len(window) / len(query).
    The larger of the two scores is returned.
    """
    best = 0.0
    if len(term) >= MIN_EXACT_LEN and (" " + term) in (" " + query):
        best = min(1.0, len(term) / len(query))

    if len(term) >= MIN_FUZZY_LEN:
        n = term.count(" ") + 1
        for size in sorted({min(n, len(query_tokens)), min(n + 1, len(query_tokens))}):
            for start in range(len(query_tokens) - size + 1):
                window = " ".join(query_tokens[start:start + size])
                sim = similarity(term, window)
                if sim >= MIN_SIMILARITY:
                    best = max(best, sim * min(1.0, len(window) / len(query)))
    return best


def _lexical_scores(normalized_query: str) -> dict[str, float]:
    """{item_id: best _term_score over the item's names and keywords}, in [0, 1]."""
    tokens = normalized_query.split()
    return {
        item.id: max((_term_score(t, normalized_query, tokens) for t in terms), default=0.0)
        for item, terms in _search_terms()
    }


def _semantic_scores(query: str) -> dict[str, float]:
    """{item_id: cosine similarity}, min-max scaled to [0, 1] within this query.

    Why scale: e5 cosines bunch up (about 0.80-0.89 for every item), while
    lexical scores use the whole 0-1 range. After scaling, the best item for
    this query gets 1 and the worst gets 0, so ``w`` really sets the balance.
    If every cosine is equal, the semantic part carries no information: all 0.
    """
    raw = _vector_index().scores(query)
    if not raw:
        return {}
    low, high = min(raw.values()), max(raw.values())
    if high - low < 1e-9:
        return {item_id: 0.0 for item_id in raw}
    return {item_id: (s - low) / (high - low) for item_id, s in raw.items()}


# ---------------------------------------------------------------- public API

def search(query: str, k: int) -> list[dict]:
    """Find the k menu items that best match a free-text query.

    The query can be in Uzbek, English or Korean, and may have typos:
    "where are my grades?", "baholarim qayerda?", "성적 조회", "grdaes".

    Hybrid search:
      final = w × semantic + (1 − w) × lexical,   w = SEMANTIC_WEIGHT (default 0.5)
      * lexical: edit-distance matching against names and keywords (_term_score)
      * semantic: embedding cosine, min-max scaled per query (_semantic_scores)
    The best k items are picked with a heap (index/topk.py). Items scoring 0 are dropped.

    Args:
        query: User text. It must not be empty after normalizing.
        k: Maximum number of results, k >= 1.

    Returns:
        Up to k dicts, best first. Each has every MenuItem field plus
        ``"score": float`` in [0, 1] (higher is better, rounded to 4 decimals).
        Ties are broken by id. With w > 0 almost every query returns
        something, so check the score; with w = 0, [] means no lexical match.

    Raises:
        ValueError: if the query is empty or k < 1.
    """
    return search_with_weight(query, k, SEMANTIC_WEIGHT)


def search_with_weight(query: str, k: int, weight: float) -> list[dict]:
    """search() with an explicit w: 0 = lexical only, 1 = semantic only. Used by eval/."""
    if k < 1:
        raise ValueError("k must be >= 1")
    if not 0.0 <= weight <= 1.0:
        raise ValueError("weight must be in [0, 1]")
    q = normalize(query)
    if not q:
        raise ValueError("query must not be empty")

    lexical = _lexical_scores(q)
    semantic = _semantic_scores(query.strip()) if weight > 0 else {}

    scored = []
    for item, _ in _search_terms():  # sorted by id, so ties go to the smaller id
        score = weight * semantic.get(item.id, 0.0) + (1 - weight) * lexical[item.id]
        if score > 0:
            scored.append((round(score, 4), item))

    return [{**item.to_dict(), "score": score} for score, item in top_k(scored, k)]


def route(from_id: str, to_id: str) -> list[str]:
    """Return the click path from one menu item to another.

    The menu map is treated as an undirected graph: each parent_id link is an
    edge. The path is found with BFS, so it has the fewest clicks.
    Usually from_id is the page the student is on now (or "portal.root").

    Example:
        route("portal.root", "sjpt.grade_current")
        -> ["portal.root", "portal.sjpt", "sjpt.class_grade",
            "sjpt.grade_eval", "sjpt.grade_current"]

    Returns:
        Menu item ids from from_id to to_id, both included.
        [from_id] if they are the same. [] if no path exists.

    Raises:
        KeyError: if either id is not in the menu map.
    """
    return bfs_path(_graph(), from_id, to_id)


def get_items(ids: list[str]) -> list[dict]:
    """Return the full menu items for the given ids, in the same order.

    The extension calls this after route() to show breadcrumbs (names) and to
    find each step on the page (selector, names).

    Raises:
        KeyError: if any id is not in the menu map.
    """
    all_items = load_menu_items()
    return [all_items[item_id].to_dict() for item_id in ids]


def suggest(prefix: str) -> list[str]:
    """Autocomplete: return menu names and keywords that start with the prefix.

    Matches name_ko, name_en and keywords with a trie. Matching ignores case
    and punctuation, and Korean matches at jamo level, so "ㅈㅏㅇ" or "장ㅎ"
    finds "장학금".

    Returns:
        At most 10 strings (original spelling), shortest completion first, then
        alphabetical. [] for an empty prefix or no match.
    """
    return _trie().starts_with(prefix, SUGGEST_LIMIT)
