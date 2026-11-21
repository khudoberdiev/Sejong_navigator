# AI-generated — to be rewritten by me
"""VectorIndex and its disk cache, with FakeEmbedder (no model download)."""
import dataclasses

import numpy as np
import pytest

from core.data import load_menu_items
from ml.fake_embedder import FakeEmbedder
from ml.vector_index import VectorIndex


@pytest.fixture
def items():
    return sorted(load_menu_items().values(), key=lambda i: i.id)


def test_fake_embedder_is_deterministic_and_normalised():
    a = FakeEmbedder().encode(["my grades", "성적"])
    b = FakeEmbedder().encode(["my grades", "성적"])
    assert np.array_equal(a, b)
    assert np.allclose(np.linalg.norm(a, axis=1), 1.0)


def test_scores_cover_every_item(items):
    index = VectorIndex(FakeEmbedder())
    index.build(items)
    scores = index.scores("borrowed books")
    assert set(scores) == {i.id for i in items}
    assert all(-1.0 - 1e-6 <= s <= 1.0 + 1e-6 for s in scores.values())


def test_query_returns_k_best_first(items):
    index = VectorIndex(FakeEmbedder())
    index.build(items)
    result = index.query("Grade History Inquiry", 3)
    assert len(result) == 3
    assert [s for _, s in result] == sorted((s for _, s in result), reverse=True)
    assert result[0][0] == "sjpt.completed_grades_inquiry"


def test_empty_index():
    index = VectorIndex(FakeEmbedder())
    index.build([])
    assert index.scores("x") == {}
    assert index.query("x", 3) == []


def test_no_cache_dir_writes_nothing(items, tmp_path):
    index = VectorIndex(FakeEmbedder(), cache_dir=None)
    index.build(items)
    assert not index.loaded_from_cache
    assert list(tmp_path.iterdir()) == []


def test_second_build_loads_from_cache(items, tmp_path):
    first = VectorIndex(FakeEmbedder(), cache_dir=tmp_path)
    first.build(items)
    assert not first.loaded_from_cache
    assert len(list(tmp_path.glob("*.npz"))) == 1

    embedder = FakeEmbedder()
    second = VectorIndex(embedder, cache_dir=tmp_path)
    second.build(items)
    assert second.loaded_from_cache
    assert embedder.calls == 0  # nothing was re-embedded
    assert np.array_equal(first.vectors, second.vectors)


def test_changed_menu_map_rebuilds_and_drops_stale_cache(items, tmp_path):
    VectorIndex(FakeEmbedder(), cache_dir=tmp_path).build(items)
    old_files = set(tmp_path.glob("*.npz"))

    changed = [dataclasses.replace(items[0], description="something new"), *items[1:]]
    index = VectorIndex(FakeEmbedder(), cache_dir=tmp_path)
    index.build(changed)
    assert not index.loaded_from_cache
    new_files = set(tmp_path.glob("*.npz"))
    assert len(new_files) == 1 and new_files != old_files
