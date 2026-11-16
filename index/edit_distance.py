# AI-generated — to be rewritten by me
"""Edit distance, so lexical search still works with typos ("grdaes" -> "grades")."""
from __future__ import annotations


def levenshtein(a: str, b: str) -> int:
    """Return the minimum number of single-character inserts, deletes and
    substitutions needed to turn a into b.

    Dynamic programming: dist[i][j] = distance between a[:i] and b[:j].
        dist[i][0] = i, dist[0][j] = j
        dist[i][j] = min(dist[i-1][j] + 1,                        # delete a[i-1]
                         dist[i][j-1] + 1,                        # insert b[j-1]
                         dist[i-1][j-1] + (a[i-1] != b[j-1]))     # substitute / keep
    Row i only needs row i-1, so we keep just two rows.
    Time O(len(a) * len(b)), memory O(min(len(a), len(b))).

    Note: swapping two neighbouring letters ("grdaes") costs 2 here, not 1.
    (Damerau-Levenshtein would count it as 1.)

        levenshtein("kitten", "sitting") == 3
        levenshtein("", "abc") == 3
    """
    if len(a) < len(b):
        a, b = b, a  # make b the shorter string, so the rows are short
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (ca != cb),
            ))
        previous = current
    return previous[-1]


def similarity(a: str, b: str) -> float:
    """Return a score in [0.0, 1.0]: 1 - levenshtein(a, b) / max(len(a), len(b)).

    Two empty strings give 1.0.

        similarity("grdaes", "grades") == 1 - 2/6 ≈ 0.667
    """
    longest = max(len(a), len(b))
    if longest == 0:
        return 1.0
    return 1.0 - levenshtein(a, b) / longest
