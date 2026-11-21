# AI-generated — to be rewritten by me
"""Data model for one menu item from data/menu_map.json."""
from __future__ import annotations

import html
import re
from dataclasses import asdict, dataclass
from typing import Optional

SITES = ("portal", "sjpt", "ecampus", "library")

# Notes in name_en that only tell OUR items apart ("Study room booking (home)" vs the menu
# entry): useful to search, never shown. label_en drops them.
DISPLAY_NOTES = ("home", "footer", "quick menu", "dashboard", "libseat", "links tab", "header", "sub-page")
_NOTE = re.compile(r"\s*\((?:" + "|".join(re.escape(n) for n in DISPLAY_NOTES) + r")\)\s*$", re.IGNORECASE)


def display_label_en(name_en: str, name_en_site: Optional[str]) -> str:
    """The English label users see (breadcrumbs, results, Keep-English on the page): the site's
    own English label if it has one, else name_en without a trailing note like "(home)"."""
    if name_en_site and name_en_site.strip():
        return html.unescape(name_en_site).strip()
    return _NOTE.sub("", name_en or "").strip()


@dataclass(frozen=True)
class MenuItem:
    """One clickable menu entry on a Sejong website.

    Attributes:
        id: Unique, stable id, e.g. "sjpt.current_semester_grades".
        site: One of SITES.
        name_ko: Korean menu label as shown on the site in Korean mode.
        name_en: Our English name (a readable translation; Keep-English shows it).
        parent_id: Id of the menu item you click before this one. None only for portal.root.
        url: Direct URL if the page has a stable one, otherwise None.
        description: Short free text that helps search (synonyms, what the page is for).
        keywords: Optional synonyms in Uzbek, English and Korean, e.g. ("baholarim", "my grades", "성적").
        name_en_site: The label the site itself shows in English mode, exactly as recorded
            (it may contain HTML entities such as "&#38;"). None if the site shows no
            English label; for SJPT that means the menu exists only in Korean mode.
        selector_desktop: CSS selector of the element in the desktop layout, or None.
        selector_mobile: CSS selector of the element in the mobile layout, or None.
            With both None the extension finds the element by its text.
        mobile_path_note: Free-text hint on how to reach the item (e.g. "open hamburger ≡ first").
        frame: Where the element lives, for humans (e.g. a WebSquare wframe); not used by code.
        opens_new_tab: True if clicking the item opens a new browser tab.
    """

    id: str
    site: str
    name_ko: str
    name_en: str
    parent_id: Optional[str]
    url: Optional[str]
    description: str
    keywords: tuple[str, ...] = ()
    name_en_site: Optional[str] = None
    selector_desktop: Optional[str] = None
    selector_mobile: Optional[str] = None
    mobile_path_note: Optional[str] = None
    frame: Optional[str] = None
    opens_new_tab: bool = False

    @property
    def site_label_en(self) -> Optional[str]:
        """name_en_site with HTML entities decoded ("Q&#38;A" -> "Q&A"), or None."""
        return html.unescape(self.name_en_site).strip() if self.name_en_site else None

    @property
    def label_en(self) -> str:
        """English label for display (display_label_en). Search still uses name_en."""
        return display_label_en(self.name_en, self.name_en_site)

    def names(self) -> list[str]:
        """name_ko, name_en and the site's English label, without duplicates, in that order."""
        out: list[str] = []
        for name in (self.name_ko, self.name_en, self.site_label_en):
            if name and name not in out:
                out.append(name)
        return out

    def search_terms(self) -> list[str]:
        """Every text that search and autocomplete match against: the names, then the keywords.

        The site's English label is included because students in English mode type what they see.
        """
        return [*self.names(), *self.keywords]

    def to_dict(self) -> dict:
        """Return a plain, JSON-serialisable dict. Servers send this over the wire."""
        d = asdict(self)
        d["keywords"] = list(self.keywords)
        return d
