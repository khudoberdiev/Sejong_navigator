#!/bin/sh
# AI-generated — to be rewritten by me
# Load the menu map and the model BEFORE accepting requests, so the first /search is fast
# (the first container start downloads the model into the model-cache volume).
set -e
python -c "import core; core.search('warm up', 1); print('model ready')"
exec uvicorn api.main:app --host 0.0.0.0 --port 8000
