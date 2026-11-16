# AI-generated — to be rewritten by me
"""Pick the k best results with a heap (heapq)."""
from __future__ import annotations

import heapq
from typing import Iterable, TypeVar

T = TypeVar("T")


def top_k(scored: Iterable[tuple[float, T]], k: int) -> list[tuple[float, T]]:
    """Return the k pairs with the highest score, best first.

    How it works: keep a min-heap of at most k entries, so the worst kept entry
    is always at heap[0]. For each new pair:
      * if the heap has fewer than k entries, push it;
      * else, if the new pair beats heap[0], replace heap[0] with it (heapreplace).
    Time O(n log k), memory O(k). That is better than sorting everything,
    O(n log n), when k is much smaller than n.

    Ties: when two scores are equal, the pair that came first in the input wins.
    Heap entries are (score, -position, item). Among equal scores, the later
    pair has the smaller -position, so it sits at heap[0] and is dropped first.
    Because positions are unique, the items themselves are never compared.

    Args:
        scored: (score, item) pairs, in any order.
        k: How many to keep. k <= 0 returns [].
    """
    if k <= 0:
        return []
    heap: list[tuple[float, int, T]] = []
    for position, (score, item) in enumerate(scored):
        entry = (score, -position, item)
        if len(heap) < k:
            heapq.heappush(heap, entry)
        elif entry[:2] > heap[0][:2]:
            heapq.heapreplace(heap, entry)
    heap.sort(key=lambda e: (e[0], e[1]), reverse=True)  # best first; earlier input first on ties
    return [(score, item) for score, _, item in heap]
