<!-- AI-generated — to be rewritten by me -->
# server/ — raw-TCP HTTP server (hand-written)

This folder is intentionally empty. The plan is to write an HTTP/1.1 server here
on top of `socket`, without any web framework.

Rules:
- Import only `from core import search, route, suggest, get_items`. Do not call `index/`, `ml/` or `data/` directly.
- Endpoints: `/health`, `/search`, `/route`, `/suggest`, `/items`. CORS: answer `OPTIONS` preflights and
  echo `Access-Control-Allow-Origin` only for `chrome-extension://...` origins.
- Follow the same HTTP contract as `api/` (see the root README), so that the
  extension works with either server without changes.
