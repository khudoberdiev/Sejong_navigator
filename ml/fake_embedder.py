# AI-generated — to be rewritten by me
"""A tiny, deterministic stand-in for the real model. Used by tests: no download, no torch.

Each text becomes a "bag of character trigrams" hashed into ``dim`` buckets,
then L2-normalised. Texts that share letters get similar vectors. That is
enough to test the plumbing; it is NOT real semantic search.
"""
from __future__ import annotations

import zlib
from typing import Sequence

import numpy as np

from index.text import normalize


class FakeEmbedder:
    model_name = "fake-trigram"

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim
        self.calls = 0  # how many times encode() ran; tests use it to check the cache

    def encode(self, texts: Sequence[str], kind: str = "query") -> np.ndarray:
        self.calls += 1
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            padded = f"  {normalize(text)} "
            for i in range(len(padded) - 2):
                bucket = zlib.crc32(padded[i:i + 3].encode()) % self.dim  # crc32: same every run
                out[row, bucket] += 1.0
            norm = np.linalg.norm(out[row])
            if norm:
                out[row] /= norm
        return out
