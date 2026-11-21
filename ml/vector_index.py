# AI-generated — to be rewritten by me
"""In-memory vector index over the menu items (brute-force cosine similarity).

Item vectors are computed once and cached on disk as
``<cache_dir>/<model>-<hash>.npz``. The hash covers the model name and every
item's id + passage text, so editing menu_map.json (or passage_text) gives a
new hash and the vectors are rebuilt automatically.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import TYPE_CHECKING, Iterable

import numpy as np

from index.topk import top_k
from ml.embedder import passage_text

if TYPE_CHECKING:
    from core.models import MenuItem


class VectorIndex:
    """Holds one embedding per menu item and answers nearest-neighbour queries.

    With about 100 items, one matrix-vector product per query is fast enough
    (O(n · dim)), so no approximate-nearest-neighbour library is needed.
    """

    def __init__(self, embedder, cache_dir: Path | None = None) -> None:
        """``embedder``: anything with ``model_name`` and ``encode(texts, kind)``.
        ``cache_dir``: where to keep the vectors; None turns the disk cache off."""
        self.embedder = embedder
        self.cache_dir = Path(cache_dir) if cache_dir is not None else None
        self.ids: list[str] = []
        self.vectors = np.zeros((0, 0), dtype=np.float32)
        self.loaded_from_cache = False

    def _cache_file(self, texts: list[str]) -> Path:
        digest = hashlib.sha256(self.embedder.model_name.encode())
        for item_id, text in zip(self.ids, texts):
            digest.update(f"\n{item_id}\t{text}".encode())
        slug = re.sub(r"[^A-Za-z0-9]+", "_", self.embedder.model_name)
        return self.cache_dir / f"{slug}-{digest.hexdigest()[:16]}.npz"

    def build(self, items: Iterable[MenuItem], texts: list[str] | None = None) -> None:
        """Embed each item's passage_text (or ``texts``, one per item: core/calendar.py indexes
        calendar rows this way), or load the vectors from the disk cache."""
        items = list(items)
        self.ids = [item.id for item in items]
        texts = [passage_text(item) for item in items] if texts is None else list(texts)
        self.loaded_from_cache = False

        cache_file = self._cache_file(texts) if self.cache_dir else None
        if cache_file and cache_file.exists():
            with np.load(cache_file) as data:
                if list(data["ids"]) == self.ids:
                    self.vectors = data["vectors"]
                    self.loaded_from_cache = True
                    return

        self.vectors = self.embedder.encode(texts, kind="passage")
        if cache_file:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            slug_prefix = cache_file.name.rsplit("-", 1)[0] + "-"
            for old in self.cache_dir.glob(slug_prefix + "*.npz"):  # drop stale caches of this model
                old.unlink()
            np.savez(cache_file, ids=np.array(self.ids), vectors=self.vectors)

    def scores(self, text: str) -> dict[str, float]:
        """Cosine similarity between the query and every item: {item_id: cosine}."""
        if not self.ids:
            return {}
        query_vector = self.embedder.encode([text], kind="query")[0]
        sims = self.vectors @ query_vector
        return {item_id: float(s) for item_id, s in zip(self.ids, sims)}

    def query(self, text: str, k: int) -> list[tuple[str, float]]:
        """Return up to k (item_id, cosine_similarity) pairs, most similar first."""
        best = top_k([(score, item_id) for item_id, score in self.scores(text).items()], k)
        return [(item_id, score) for score, item_id in best]
