// AI-generated — to be rewritten by me
// The ONLY place to change which backend the extension talks to.
//   FastAPI:          .venv/bin/uvicorn api.main:app --reload --port 8000
//   Your TCP server:  point BACKEND_URL at its port. manifest.json allows any port on 127.0.0.1 / localhost.
// After editing, press the reload button for the extension in chrome://extensions.
globalThis.SEJONG_CONFIG = Object.freeze({
  BACKEND_URL: "http://127.0.0.1:8000",
  ROOT_ID: "portal.root", // every route starts here
  SEARCH_K: 3,            // results shown in the popup
});
