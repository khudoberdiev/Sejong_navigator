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

To load the extension: go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `extension/`.

## HTTP contract (both servers must match)

| Request | 200 response body |
|---------|-------------------|
| `GET /health` | `{"status": "ok"}` |
| `GET /search?q=<text>&k=<1..50, default 5>` | `[{...menu item fields, "score": float}, ...]` |
| `GET /route?from=<id>&to=<id>` | `["id1", "id2", ...]` |
| `GET /suggest?prefix=<text>` | `["name or keyword", ...]` (max 10) |
| `GET /items?ids=<id1>,<id2>,...` | `[{...menu item fields}, ...]` in the same order (`[]` for empty `ids`) |

Errors return `{"detail": "<message>"}` with status 400 (bad argument), 404 (unknown id)
or 501 (not implemented yet).
