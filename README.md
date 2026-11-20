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
| `ml/`        | Multilingual embedding search (CPU) + fine-tuning (`ml/finetune.py`) |
| `api/`       | FastAPI server |
| `server_ai/` | Raw-TCP HTTP server, standard library only (AI reference version) |
| `server/`    | Your hand-written raw-TCP server |
| `extension/` | Chrome extension (Manifest V3) |
| `data/`      | `menu_map.json`, the menu tree (no personal data) |
| `tests/`     | pytest (+ `tests/js/` run with macOS JavaScriptCore) |
| `eval/`      | Model sanity check + accuracy evaluation (`eval/results.md`) |
| `scripts/`   | `sync_extension_data.py`: copies the menu map into the extension |

## Setup (macOS)

```bash
/opt/homebrew/bin/python3.12 -m venv .venv      # any Python 3.11+
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q                   # fast tests, fake embedder, no download
.venv/bin/python -m pytest -q -m slow           # real model (downloads ~470 MB once)
.venv/bin/python -m eval.run_eval               # accuracy table -> eval/results.md
```

Run ONE backend from the project root, on **port 8000** (or change `BACKEND_URL` in
`extension/config.js`; any port on 127.0.0.1/localhost is allowed):

```bash
.venv/bin/uvicorn api.main:app --reload --port 8000     # FastAPI
.venv/bin/python -m server_ai --port 8000               # raw TCP, same answers
```

## Run with Docker

```bash
docker compose up --build                        # FastAPI on http://127.0.0.1:8000
docker compose --profile tcp up --build          # + server_ai on http://127.0.0.1:8001
docker compose --profile translate up            # + self-hosted LibreTranslate on :5000
SEJONG_MODEL=models/e5-small-sejong docker compose up   # serve the fine-tuned model
```

- The image uses CPU-only PyTorch.
- The first start downloads the model into the `model-cache` volume, so the health check gives it 3 minutes. Later starts take seconds.
- `data/` and `models/` are mounted read-only. After editing the menu map, restart with `docker compose restart api`.
- Ports bind to 127.0.0.1 only.

## Search

`final = w × semantic + (1 − w) × lexical`, where the semantic score is the e5 cosine
min-max scaled to 0–1 for each query.

| Setting | Default |
|---|---|
| `SEJONG_SEMANTIC_WEIGHT` | `0.5` (`0` = lexical only) |
| `SEJONG_MODEL` | `intfloat/multilingual-e5-small`; a local folder works too (`models/e5-small-sejong`) |
| `SEJONG_CACHE_DIR` | `.cache/embeddings` (rebuilt automatically when the menu map or model changes) |
| `SEJONG_DEVICE` | `cpu` (`mps` is possible) |

## Fine-tuning

```bash
.venv/bin/python -m ml.finetune                              # synthetic pairs (names/keywords × templates)
.venv/bin/python -m ml.finetune --pairs data/real_pairs.jsonl  # real questions, one per line:
#   {"query": "baholarimni qayerdan ko'raman", "item_id": "sjpt.grade_current", "lang": "uz"}
.venv/bin/python -m eval.run_eval                            # copies the comparison into eval/results.md
```

- The model is saved to `models/e5-small-sejong/`, along with `sejong_finetune.json` (settings, loss) and the held-out pairs.
- The run stops if the leakage check finds any shared phrasing between the training and held-out sets.
- Training questions that nearly copy `eval/questions.py` are always dropped.

## Chrome extension

**Load:** `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `extension/`.
After editing extension files, press ⟳ on the extension card, then reload the Sejong tabs.

**Open:** click the toolbar icon. The UI opens in Chrome's **side panel** and stays open while you click
and navigate the page. Close it with ✕ in the panel header or the toolbar icon again.

**Search:** type in the side panel (suggestions appear while you type) → Enter → pick one of the top 3 →
breadcrumbs (Korean + English) → **Show me on this page** outlines the next menu item to click.

The running guide is kept in `chrome.storage.session` (one guide for the whole browser, cleared when
Chrome closes). Every Sejong page load, including a new tab that SSO opens for SJPT, highlights the
current step again by itself. Clicking the highlighted item moves to the next step; clicking the final
item, or **Stop**, ends the guide. The side panel shows the status for whichever tab is active.

**Keep-English** (on by default, side panel → Settings):
- After every page load and every menu change, known Korean menu labels are replaced with their English names. Hovering shows the Korean.
- The labels come from `extension/data/menu_map.json` plus your recorded items that have an English name. Run `.venv/bin/python scripts/sync_extension_data.py` after editing `data/menu_map.json`.
- It pauses while recording, so recordings keep the Korean labels.

**Pop-up translation** (on by default):
- Modal pop-ups (dialogs and "layer" pop-ups, in any frame) and `alert()`/`confirm()` messages get an English overlay in the corner. For `alert()` the overlay appears after you close the alert.
- Translation runs **on this computer**:
  1. Chrome's built-in Translator API (Chrome 138+). Free, no key. A one-time language download starts when you click **Download translator** in the overlay.
  2. Optional: your own LibreTranslate (`docker compose --profile translate up`, then set `TRANSLATE_URL` in `config.js`).
- No public translation service is ever used, because pop-ups can contain personal data.

**Record a menu** (produces `menu_map.json` data):
1. Log in to the site normally. Open the side panel → **Record menu**.
2. **Scan menus on this page** reads every menu entry it can find (all frames). Good for `<ul>/<li>` menus.
3. **Start recording clicks**, then click through the menu from the top level
   to the page you want (e.g. 학사정보시스템 → 수업/성적 → 성적 및 강의평가 → 금학기 성적조회).
   Each recorded click flashes green; a click that was refused (looks like personal data) flashes amber.
4. In the panel, check the "Next click becomes a child of" breadcrumb and the list (✕ deletes a wrong item).
   Press **New path** before recording the next branch from the top. **Undo last** removes the last click.
5. Repeat on other pages and sites. Everything merges into one store, even after a browser restart.
6. **Export JSON** downloads `menu_map.recorded.<date>.json`. Fill in the empty `name_en`/`name_ko`,
   `description` and `keywords`, then copy it to `data/menu_map.json` (or use `SEJONG_MENU_MAP=<file>`).
   **Import JSON** merges an earlier export back in.

## HTTP contract (every server must match: `tests/test_server_parity.py`)

| Request | 200 response body |
|---------|-------------------|
| `GET /health` | `{"status": "ok"}` |
| `GET /search?q=<text>&k=<1..50, default 5>` | `[{...menu item fields, "score": float}, ...]` |
| `GET /route?from=<id>&to=<id>` | `[{...menu item fields}, ...]`: one per step, in click order (`[]` if no path) |
| `GET /suggest?prefix=<text>` | `["name or keyword", ...]` (max 10) |

Bodies are compact UTF-8 JSON (`content-type: application/json`). Errors are `{"detail": "<message>"}`:

| Status | When |
|---|---|
| 400 | Bad argument. Messages: `missing query parameter: q`, `k must be an integer`, `k must be between 1 and 50`, `query must not be empty` |
| 404 | Unknown id (`unknown id: <id>`), or unknown path (`Not Found`) |
| 405 | Wrong method, incl. HEAD (`Method Not Allowed`, header `allow: GET`) |
| 307 | Trailing slash, e.g. `/health/` redirects to `/health` |
| 500 | Unexpected error (`Internal Server Error`) |

- **Query parameters:** UTF-8 percent-decoding; `+` means a space; if a parameter is repeated, the last value wins.
- **CORS:** `chrome-extension://…` origins only.
  - Normal responses carry `vary: Origin`, plus `access-control-allow-origin: <origin>` when the origin is allowed.
  - Preflights are answered like Starlette's `CORSMiddleware`: 200 `OK`, or 400 `Disallowed CORS origin/method/headers`.
