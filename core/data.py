# AI-generated — to be rewritten by me
"""Loads data/menu_map.json into MenuItem objects.

The file location can be changed with the SEJONG_MENU_MAP environment variable.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from core.models import SITES, MenuItem

DEFAULT_MENU_MAP = Path(__file__).resolve().parent.parent / "data" / "menu_map.json"
REQUIRED_FIELDS = ("id", "site", "name_ko", "name_en", "parent_id", "url", "selector", "description")


def menu_map_path() -> Path:
    """Return the menu map path: SEJONG_MENU_MAP if set, otherwise the default."""
    return Path(os.environ.get("SEJONG_MENU_MAP", DEFAULT_MENU_MAP))


@lru_cache(maxsize=1)
def load_menu_items() -> dict[str, MenuItem]:
    """Read the menu map and return {id: MenuItem}.

    Only basic shape checks happen here: required fields, a valid site, unique ids,
    parent ids that exist, and an optional "keywords" list of strings. Deeper checks live in tests/test_menu_map.py.

    Raises:
        ValueError: if the file has the wrong shape.
    """
    raw = json.loads(menu_map_path().read_text(encoding="utf-8"))
    items: dict[str, MenuItem] = {}
    for entry in raw["items"]:
        missing = [f for f in REQUIRED_FIELDS if f not in entry]
        if missing:
            raise ValueError(f"menu item {entry.get('id')!r} is missing fields: {missing}")
        if entry["site"] not in SITES:
            raise ValueError(f"menu item {entry['id']!r} has unknown site {entry['site']!r}")
        if entry["id"] in items:
            raise ValueError(f"duplicate menu item id {entry['id']!r}")
        keywords = entry.get("keywords", [])
        valid = isinstance(keywords, list) and all(isinstance(k, str) and k.strip() for k in keywords)
        if not valid:
            raise ValueError(f"menu item {entry['id']!r}: keywords must be a list of strings")
        items[entry["id"]] = MenuItem(**{f: entry[f] for f in REQUIRED_FIELDS}, keywords=tuple(keywords))

    for item in items.values():
        if item.parent_id is not None and item.parent_id not in items:
            raise ValueError(f"menu item {item.id!r} has unknown parent {item.parent_id!r}")
    return items
