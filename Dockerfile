# AI-generated — to be rewritten by me
# Sejong Navigator backend (FastAPI by default; server_ai via docker-compose profile "tcp").
#   docker compose up --build
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TOKENIZERS_PARALLELISM=false \
    HF_HOME=/home/app/.cache/huggingface \
    SEJONG_CACHE_DIR=/home/app/.cache/embeddings

WORKDIR /app

# CPU-only PyTorch first: the default wheel would also pull ~2 GB of CUDA libraries.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY core core
COPY index index
COPY ml ml
COPY api api
COPY server_ai server_ai
COPY data data
COPY docker/start.sh /usr/local/bin/start.sh

RUN useradd --create-home app \
    && mkdir -p /home/app/.cache \
    && chown -R app /home/app/.cache \
    && chmod +x /usr/local/bin/start.sh
USER app

# Optional: bake the base model into the image so the first start needs no download.
#   docker compose build --build-arg PRELOAD_MODEL=1
ARG PRELOAD_MODEL=0
RUN if [ "$PRELOAD_MODEL" = "1" ]; then python -c "from ml.embedder import Embedder; Embedder().encode(['warm up'])"; fi

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status != 200)"

CMD ["start.sh"]
