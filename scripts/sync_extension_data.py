# AI-generated — to be rewritten by me
"""Copy data/menu_map.json into the extension (used by Keep-English).

    .venv/bin/python scripts/sync_extension_data.py

Run it after every change to the menu map, then reload the extension.
tests/test_extension_js.py fails while the two copies differ.
"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "menu_map.json"
TARGET = ROOT / "extension" / "data" / "menu_map.json"


def main() -> None:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, TARGET)
    print(f"copied {SOURCE.relative_to(ROOT)} -> {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
