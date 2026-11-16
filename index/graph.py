# AI-generated — to be rewritten by me
"""Menu graph and BFS shortest click path."""
from __future__ import annotations

from collections import deque
from typing import TYPE_CHECKING, Iterable

if TYPE_CHECKING:  # type hints only; a real import would be circular (core imports index)
    from core.models import MenuItem


def build_graph(items: Iterable[MenuItem]) -> dict[str, list[str]]:
    """Build an adjacency list {id: [neighbour ids]} from the parent_id links.

    Edges go both ways (parent <-> child), so a route can go back up the menu
    and then down a different branch. Neighbour lists are sorted, so BFS
    always returns the same path. Time O(V + E log E) because of the sorting.
    """
    graph: dict[str, list[str]] = {}
    for item in items:
        graph.setdefault(item.id, [])
        if item.parent_id is not None:
            graph.setdefault(item.parent_id, [])
            graph[item.id].append(item.parent_id)
            graph[item.parent_id].append(item.id)
    for neighbours in graph.values():
        neighbours.sort()
    return graph


def bfs_path(graph: dict[str, list[str]], start: str, goal: str) -> list[str]:
    """Return the shortest path from start to goal (both included), found with BFS.

    BFS visits nodes in order of distance from start, so the first time it
    reaches goal, it has found a path with the fewest edges (= fewest clicks).
    ``came_from`` remembers each node's predecessor, and we walk it backwards
    from goal to rebuild the path. Time O(V + E), memory O(V).

    Returns [start] if start == goal, or [] if goal cannot be reached.

    Raises:
        KeyError: if start or goal is not in the graph.
    """
    for node in (start, goal):
        if node not in graph:
            raise KeyError(node)
    if start == goal:
        return [start]

    came_from: dict[str, str | None] = {start: None}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        if node == goal:
            break
        for neighbour in graph[node]:
            if neighbour not in came_from:
                came_from[neighbour] = node
                queue.append(neighbour)

    if goal not in came_from:
        return []
    path = []
    node: str | None = goal
    while node is not None:
        path.append(node)
        node = came_from[node]
    return path[::-1]
