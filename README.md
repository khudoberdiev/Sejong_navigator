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
| `data/`      | `raw/<site>.json`: menus recorded from the live sites; `menu_map.json`: the merged tree (generated, no personal data) |
| `tests/`     | pytest (+ `tests/js/` run with macOS JavaScriptCore) |
| `eval/`      | Model sanity check + accuracy evaluation (`eval/results.md`) |
| `scripts/`   | `build_menu_map.py`: merges `data/raw/*.json` into the menu map (+ the extension's copy); `sync_extension_data.py`: only copies it |

## Menu data

Edit `data/raw/<site>.json`, never `data/menu_map.json`, then rebuild:

```bash
.venv/bin/python scripts/build_menu_map.py          # validate, write data/menu_map.json + extension/data/, print a summary
.venv/bin/python scripts/build_menu_map.py --check  # only check that both copies are up to date
```

- The build stops and lists every problem: wrong or missing fields, unknown site, duplicate ids, a `parent_id` that does not exist, cycles, links between sites, a URL with a login token or session in its query (libseat links carry `?token=…`: store them without the query).
- It adds one derived field, `label_en`: the English label users see (the site's own English label, else `name_en` without a note like "(home)" or "(footer)" that only tells our items apart). Search keeps using `name_en`.
- It checks `data/answers.json` (answer cards, see below) and copies it to `extension/data/`.
- It adds `portal.root` (the portal main page; every route starts there) and hangs every top-level portal item under it.
- The top-level items of the other sites hang under the portal link that opens them: SJPT under `portal.sjpt`, e-Campus under `portal.ecampus`, the library under `portal.library` (`ENTRY_POINTS` in the script). So a route from the portal into SJPT always goes through `portal.sjpt`, which opens SJPT in a new tab.
- `tests/test_menu_map.py` fails while `menu_map.json` is older than the raw files.

Fields of one item (all required in the raw files):

| Field | Meaning |
|---|---|
| `id`, `site`, `parent_id` | Stable id, site (`portal`/`sjpt`/`ecampus`/`library`), the item you click before it (`null` = top level) |
| `name_ko`, `name_en` | Korean label on the site; our English name (may end in a note like "(home)" for search; users see `label_en`) |
| `name_en_site` | The label the site itself shows in English mode, as recorded (may contain entities like `&#38;`; decoded for search and matching). `null` = the site shows no English label |
| `selector_desktop`, `selector_mobile` | CSS selector per layout. Both `null` = found by its text (`name_ko` or `name_en_site`) |
| `mobile_path_note` | Hint on how to reach it, for humans (never shown to users) |
| `frame` | Where it lives, for humans (e.g. an SJPT WebSquare wframe; these are NOT iframes) |
| `opens_new_tab`, `url`, `description`, `keywords` | New tab on click; direct link; search text; Uzbek/English/Korean synonyms |

Search and autocomplete match `name_ko`, `name_en`, `name_en_site` and `keywords`.
An older map with a single `selector` field (what the recorder exports) still loads: the selector is used as `selector_desktop`.

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
#   {"query": "baholarimni qayerdan ko'raman", "item_id": "sjpt.current_semester_grades", "lang": "uz"}
.venv/bin/python -m eval.run_eval                            # copies the comparison into eval/results.md
```

- The model is saved to `models/e5-small-sejong/`, along with `sejong_finetune.json` (settings, loss) and the held-out pairs.
- The run stops if the leakage check finds any shared phrasing between the training and held-out sets.
- Training questions that nearly copy `eval/questions.py` are always dropped.

## Chrome extension

**Load:** `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `extension/`.
After editing extension files, press ⟳ on the extension card, then reload the Sejong tabs.

**Open:** on a Sejong page, the **floating widget** appears (default). It has three views, like Zoom:
- **mini**: a small "—" pill. Click it to expand.
- **compact**: only the click path (current step in orange, done steps struck through) and **Stop**.
- **full**: search, results, click path, status and Settings.

Use **–** / **+** in the widget header, or the toolbar icon (full ↔ mini).
- **Drag:** drag the widget by its header (or drag the pill). Its position and view are saved and shared by all tabs.
- **Never in the way:** it stays inside the window, never shifts the page (it is fixed, in a closed Shadow DOM), and moves to another corner while it would cover the highlighted element.
- **Side panel instead:** Settings → **Display: Side panel** brings back Chrome's side panel, which the toolbar icon then opens. On non-Sejong tabs the toolbar icon always opens the side panel. The menu recorder (**Record menu** tab) lives only in the side panel.

**Search:** type in the widget (or side panel); suggestions appear while you type. Press Enter, pick one of the top 3,
check the breadcrumbs (Korean + English), and press **Show me on this page** to outline the next menu item to click.
Starting a guide from the widget switches it to the compact view.

- **Ranking:** results prefer real pages over menu folders and over entry links into another site (`core/ranking.py`). The Sejong Language Institute's menus rank lower unless the query asks for them (e.g. "어학원", "language center"). Items inside an external system the extension cannot run in (libseat) count for the link that opens it. Results carry `kind` (`page`/`folder`/`entry`) and `entry_for`.
- **Starts where you are:** on the library site, a guide to a library page starts on the library, not back at the portal. A result that is only the way into the site you're already on says "You are already in the Library" and offers the best page on this site.
- **Steps on another site:** when a step is on another site, the status says so and offers **Open Portal** (etc.).
- **Tabs are reused:** when a step would open another Sejong site in a new tab and a tab of that site is already open, that tab is used instead.
- **Steps on the page you are on are done:** a step whose link leads to the page the tab already shows (same host and path; a trailing `/`, `#…`, `index.do` and extra query parameters don't matter) is skipped, when the guide starts, after every page load and after `#hash`/`pushState` navigation. On library home the guide starts at the first card, not the logo. A guide started on its target page ends with "You are already on …".
- **Off-screen targets:** when the step to click is above or below what you see (also inside a scrolling box like the SJPT menu tree), an orange arrow (↑/↓) sits at that edge of the screen. Click it to scroll there; it disappears once the target is in view and the frame shows. The page never scrolls by itself.
- **Answer cards:** some questions need an explanation, not a menu item. "seat reservation" / "좌석 예약" / "joy band qilish": reading-room seats are issued at the kiosks (1F, 3F, 4F) and can't be booked online; the card says so and offers **See free seats**, **Book a study room**, **Cinema room**, **S-Lounge**. Rules: `data/answers.json` (matched by `extension/shared.js` and `core/answers.py`, kept identical by `tests/test_answers.py`); text: `messages.json`. When a booking guide finishes (libseat opens in a new tab, where the extension does not run), the status says what to do next there.
- **Keep-English:** a Korean label is replaced by its display label (`label_en`, never "(home)"), as a whole (also when the site splits it over several text nodes), and only where that item's selector matches, so generic labels like "더보기" or "예약" stay as they are elsewhere.

**UI language:** all UI text is in `extension/_locales/<code>/messages.json` (English is complete and the default).
- Settings → **UI language: Auto** follows Chrome's language. Choosing a language uses that file.
- **Adding a language** = adding `_locales/<code>/messages.json` with a `language_name` entry. It appears in the list by itself.
- `chrome.i18n` only auto-picks locales Chrome supports (e.g. not `uz`), but a language chosen in Settings works for any code.
- Menu names always stay Korean + English.

The running guide is kept in `chrome.storage.session` (one guide for the whole browser, cleared when
Chrome closes). Every Sejong page load, including a new tab that SSO opens for SJPT, highlights the
current step again by itself. Clicking the highlighted item moves to the next step; clicking the final
item, or **Stop**, ends the guide. The side panel shows the status for whichever tab is active.

How a step is found on the page:
- `selector_desktop`, then `selector_mobile`. The first match that is visible wins, so the current layout decides.
- If both are `null`: an element whose whole text is `name_ko` or `name_en_site`. Entities are decoded, and case and spacing are ignored. Keep-English's replacements don't affect this; the site's original text is compared.
- Only items of the page's own site are looked for.
- If a step's element exists but is hidden (e.g. inside a collapsed branch of SJPT's left tree), the nearest visible parent step is highlighted first.
- SJPT tree nodes are found by their `treenodevalue` codes, which are the same in KOR and ENG mode.
- If the page is in English mode and the next SJPT step is not on the page at all and has no `name_en_site`, the panel and the pointer say "This menu only appears in Korean mode (KOR)".

**Keep-English** (on by default, side panel → Settings):
- After every page load and every menu change, known Korean menu labels are replaced with their English names. Hovering shows the Korean.
- The labels come from `extension/data/menu_map.json` plus your recorded items that have an English name. `scripts/build_menu_map.py` keeps that copy up to date.
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
6. **Export JSON** downloads `menu_map.recorded.<date>.json` (older format: one `selector`). Fill in the empty
   `name_en`/`name_ko`, `description` and `keywords`. Try it directly with `SEJONG_MENU_MAP=<file>`, or move
   its items into `data/raw/<site>.json` with the full field set (see "Menu data") and run `scripts/build_menu_map.py`.
   **Import JSON** merges an earlier export back in.

## HTTP contract (every server must match: `tests/test_server_parity.py`)

| Request | 200 response body |
|---------|-------------------|
| `GET /health` | `{"status": "ok"}` |
| `GET /search?q=<text>&k=<1..50, default 5>` | `[{...menu item fields, "score": float}, ...]` (menu item fields include the derived `label_en`, `kind` and `entry_for`) |
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
