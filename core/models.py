# AI-generated — to be rewritten by me
"""Data model for one menu item from data/menu_map.json."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

SITES = ("portal", "sjpt", "ecampus", "library")


@dataclass(frozen=True)
class MenuItem:
    """One clickable menu entry on a Sejong website.

    Attributes:
        id: Unique, stable id, e.g. "sjpt.grade_current".
        site: One of SITES.
        name_ko: Korean menu label exactly as shown on the site.
        name_en: English label (official one if it exists, otherwise a translation).
        parent_id: Id of the menu item you click before this one. None for the root.
        url: Direct URL if the page has a stable one, otherwise None.
        selector: CSS selector of the element to click/highlight, or None.
        description: Short free text that helps search (synonyms, what the page is for).
        keywords: Optional synonyms in Uzbek, English and Korean, e.g. ("baholarim", "my grades", "성적").
    """

    id: str
    site: str
    name_ko: str
    name_en: str
    parent_id: Optional[str]
    url: Optional[str]
    selector: Optional[str]
    description: str
    keywords: tuple[str, ...] = ()

    def search_terms(self) -> list[str]:
        """Return every text that search and autocomplete match against: the names, then the keywords."""
        return [self.name_ko, self.name_en, *self.keywords]

    def to_dict(self) -> dict:
        """Return a plain, JSON-serialisable dict. Servers send this over the wire."""
        d = asdict(self)
        d["keywords"] = list(self.keywords)
        return d
