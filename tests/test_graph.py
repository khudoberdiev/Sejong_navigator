# AI-generated — to be rewritten by me
import pytest

from core.models import MenuItem
from index.graph import bfs_path, build_graph


def _item(id_, parent=None):
    return MenuItem(id_, "portal", id_, id_, parent, None, "")


@pytest.fixture
def graph():
    #        root
    #       /    \
    #      a      b
    #     / \      \
    #    a1  a2     b1
    items = [_item("root"), _item("a", "root"), _item("b", "root"),
             _item("a1", "a"), _item("a2", "a"), _item("b1", "b")]
    return build_graph(items)


def test_adjacency_is_undirected_and_sorted(graph):
    assert graph["root"] == ["a", "b"]
    assert graph["a"] == ["a1", "a2", "root"]
    assert graph["a1"] == ["a"]


def test_down_the_tree(graph):
    assert bfs_path(graph, "root", "a2") == ["root", "a", "a2"]


def test_up_the_tree(graph):
    assert bfs_path(graph, "b1", "root") == ["b1", "b", "root"]


def test_across_branches(graph):
    assert bfs_path(graph, "a1", "b1") == ["a1", "a", "root", "b", "b1"]


def test_same_node(graph):
    assert bfs_path(graph, "a", "a") == ["a"]


def test_unknown_ids_raise_key_error(graph):
    with pytest.raises(KeyError):
        bfs_path(graph, "nope", "a")
    with pytest.raises(KeyError):
        bfs_path(graph, "a", "nope")


def test_unreachable_returns_empty():
    graph = build_graph([_item("x"), _item("y")])  # two separate roots
    assert bfs_path(graph, "x", "y") == []


def test_empty_graph():
    assert build_graph([]) == {}
