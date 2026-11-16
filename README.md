<!-- AI-generated — to be rewritten by me -->
# Sejong Navigator

A Chrome extension for finding pages on Sejong University's websites (Portal / SJPT,
e-Campus, Library). Ask in Uzbek, English or Korean, for example "baholarim qayerda?",
"where are my grades?" or "성적 조회". The extension shows the click path and highlights each menu item.

## Layout

| Folder       | Purpose |
|--------------|---------|
| `core/`      | The **only** interface servers use: `search`, `route`, `suggest` |
| `index/`     | Algorithms: trie, edit distance, heap top-k, BFS |
| `ml/`        | Multilingual embedding search (CPU) |
| `api/`       | Temporary FastAPI server |
| `server/`    | Hand-written raw-TCP HTTP server (not started) |
| `extension/` | Chrome extension (Manifest V3) |
| `data/`      | `menu_map.json`, the menu tree (no personal data) |
| `tests/`     | pytest |
| `eval/`      | Model sanity check + accuracy evaluation (`eval/results.md`) |

## Setup (macOS)

```bash
/opt/homebrew/bin/python3.12 -m venv .venv      # any Python 3.11+
.venv/bin/python -m pip install -r requirements.txt pytest
.venv/bin/python -m pytest -q                   # fast tests, fake embedder, no download
.venv/bin/python -m pytest -q -m slow           # real model (downloads ~470 MB once)
.venv/bin/python -m eval.run_eval               # accuracy table -> eval/results.md
.venv/bin/uvicorn api.main:app --reload --port 8000
```

## Search

`final = w × semantic + (1 − w) × lexical`, where the semantic score is the e5 cosine
min-max scaled to 0–1 for each query.

| Setting | Default |
|---|---|
| `SEJONG_SEMANTIC_WEIGHT` | `0.5` (`0` = lexical only) |
| `SEJONG_CACHE_DIR` | `.cache/embeddings` (rebuilt automatically when the menu map changes) |
| `SEJONG_DEVICE` | `cpu` (`mps` is possible) |

Run the server from the project root. It must be **port 8000**, or change `BACKEND_URL` in
`extension/config.js`; any port on 127.0.0.1/localhost is allowed.

## Chrome extension

**Load:** `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `extension/`.
After editing extension files, press ⟳ on the extension card, then reload the Sejong tabs.

**Search:** type in the popup (suggestions appear while you type) → Enter → pick one of the top 3 →
breadcrumbs (Korean + English) → **Show me on this page** outlines the next menu item to click.

**Record a menu** (produces `menu_map.json` data):
1. Log in to the site normally. Open the popup → **Record menu**.
2. **Scan menus on this page** reads every menu entry it can find (all frames). Good for `<ul>/<li>` menus.
3. **Start recording clicks**, close the popup, then click through the menu from the top level
   to the page you want (e.g. 학사정보시스템 → 수업/성적 → 성적 및 강의평가 → 금학기 성적조회).
   Each recorded click flashes green; a click that was refused (looks like personal data) flashes amber.
4. Open the popup: check the "Next click becomes a child of" breadcrumb and the list (✕ deletes a wrong item).
   Press **New path** before recording the next branch from the top. **Undo last** removes the last click.
5. Repeat on other pages and sites. Everything merges into one store, even after a browser restart.
6. **Export JSON** downloads `menu_map.recorded.<date>.json`. Fill in the empty `name_en`/`name_ko`,
   `description` and `keywords`, then copy it to `data/menu_map.json` (or use `SEJONG_MENU_MAP=<file>`).
   **Import JSON** merges an earlier export back in.

## HTTP contract (both servers must match)

| Request | 200 response body |
|---------|-------------------|
| `GET /health` | `{"status": "ok"}` |
| `GET /search?q=<text>&k=<1..50, default 5>` | `[{...menu item fields, "score": float}, ...]` |
| `GET /route?from=<id>&to=<id>` | `[{...menu item fields}, ...]`: one per step, in click order (`[]` if no path) |
| `GET /suggest?prefix=<text>` | `["name or keyword", ...]` (max 10) |

Errors return `{"detail": "<message>"}` with status 400 (bad argument), 404 (unknown id)
or 501 (not implemented yet).
