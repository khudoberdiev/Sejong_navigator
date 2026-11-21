# AI-generated — to be rewritten by me
"""What kind of menu item is this, and how much should search prefer it?

search() first scores every item by text (hybrid lexical + semantic, core/navigator.py).
That score says how well the WORDS match. These rules add what the words cannot say:

1. Kind (from the menu tree, nothing to maintain by hand):
     entry   a link into another Sejong site: it has a child on another site (portal.library),
             or its URL is on another supported site (the portal's 학사정보 shortcut → SJPT)
     folder  opens a submenu only: it has children and no URL, e.g. 성적 및 강의평가
     page    everything else: a leaf, or a link that is also a menu group (e.g. a library
             landing page, or library.seat_status_more which opens the seat booking system)
   Pages rank above folders, and folders above entry links: a student asking for "grades"
   wants the page with the grades, not the menu group around it.

2. Secondary subtrees: whole sections most students never need (the Sejong Language
   Institute's own menus). They rank below everything else, unless the query names them
   ("language center", "어학원", "Korean course", "til ...").

3. Unreachable items: items that live inside an external system the extension cannot run in
   (their parent opens an unsupported host, e.g. libseat.sejong.ac.kr). The guide can never
   highlight them, so a search hit on one counts for the nearest ancestor that is still on a
   Sejong page: the link that opens that system (library.seat_status_more).

The final score is text score × prior, so it stays in [0, 1] and an exact English label
match ("Grade") cannot beat the intent by itself.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

from core.models import SITES, MenuItem
from index.text import normalize

SUPPORTED_HOSTS = frozenset(f"{site}.sejong.ac.kr" for site in SITES)

PRIOR = {"page": 1.0, "folder": 0.8, "entry": 0.7}
SECONDARY_PRIOR = 0.7

# Root of a secondary subtree -> words that mean the student asks for it. Latin words must
# appear as whole words, Korean ones anywhere (Korean has no spaces between words in labels).
SECONDARY_SUBTREES = {
    "sjpt.sejong_language_institute": (
        "language", "language center", "language centre", "language institute", "korean course",
        "korean class", "til", "til markazi", "koreys tili", "어학원", "어학", "한국어",
    ),
}

_HOST = re.compile(r"^https?://([^/?#:]+)", re.I)


@dataclass(frozen=True)
class ItemInfo:
    kind: str                  # "page" | "folder" | "entry"
    entry_for: Optional[str]   # the site an entry link opens, else None
    secondary: Optional[str]   # root id of the secondary subtree it belongs to, else None
    fold_to: str               # the item a search hit on this one counts for (itself if reachable)


def _host(url: Optional[str]) -> Optional[str]:
    match = _HOST.match(url or "")
    return match.group(1).lower() if match else None


def opens_external_system(item: MenuItem) -> bool:
    """Its URL is on a host where the extension does not run (libseat, dcollection, ...)."""
    host = _host(item.url)
    return host is not None and host not in SUPPORTED_HOSTS


def classify(items: dict[str, MenuItem]) -> dict[str, ItemInfo]:
    """ItemInfo for every item. O(n · depth)."""
    children: dict[str, list[MenuItem]] = {}
    for item in items.values():
        if item.parent_id is not None:
            children.setdefault(item.parent_id, []).append(item)

    def ancestors(item: MenuItem):
        node = item
        while node.parent_id is not None:
            node = items[node.parent_id]
            yield node

    site_of_host = {f"{site}.sejong.ac.kr": site for site in SITES}
    info = {}
    for item in items.values():
        kids = children.get(item.id, [])
        other_sites = sorted({k.site for k in kids if k.site != item.site})
        link_site = site_of_host.get(_host(item.url) or "")
        if other_sites:
            kind, entry_for = "entry", other_sites[0]
        elif link_site and link_site != item.site:  # a shortcut into another site, e.g. 학사정보 → SJPT
            kind, entry_for = "entry", link_site
        elif kids and not item.url:
            kind, entry_for = "folder", None
        else:
            kind, entry_for = "page", None
        secondary = next((root for root in SECONDARY_SUBTREES
                          if item.id == root or any(a.id == root for a in ancestors(item))), None)
        # Inside an external system: some ancestor opens it. Fold to the topmost such ancestor
        # (the link on a Sejong page that opens the system).
        fold_to = item.id
        for ancestor in ancestors(item):
            if opens_external_system(ancestor):
                fold_to = ancestor.id
        info[item.id] = ItemInfo(kind, entry_for, secondary, fold_to)
    return info


def query_names_subtree(normalized_query: str, root_id: str) -> bool:
    """Does the (normalized) query ask for this secondary subtree?"""
    padded = f" {normalized_query} "
    for word in SECONDARY_SUBTREES[root_id]:
        key = normalize(word)
        if re.search(r"[a-z]", word):
            if f" {key} " in padded:
                return True
        elif key in normalized_query:
            return True
    return False


def prior(info: ItemInfo, normalized_query: str) -> float:
    """Multiplier in (0, 1] for this item's text score."""
    value = PRIOR[info.kind]
    if info.secondary and not query_names_subtree(normalized_query, info.secondary):
        value *= SECONDARY_PRIOR
    return value


def fold(scored: Iterable[tuple[float, str]], info: dict[str, ItemInfo]) -> dict[str, float]:
    """{item_id: best score} after moving every hit to the item it counts for."""
    best: dict[str, float] = {}
    for score, item_id in scored:
        target = info[item_id].fold_to
        if score > best.get(target, 0.0):
            best[target] = score
    return best
