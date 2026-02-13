# FinBERT Sidecar — kontener z modelem analizy sentymentu
#
# Tryb GPU (CUDA): docker compose --profile gpu up finbert
# Tryb CPU:        docker compose up finbert
#
# Obraz bazowy: NVIDIA CUDA runtime dla PyTorch + Python 3.11
# Model jest pobierany z HuggingFace przy pierwszym uruchomieniu
# i cache'owany w volume (finbert_cache)

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS base

# Zainstaluj Python 3.11
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Ustaw python3.11 jako domyślny
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

WORKDIR /app

# Zainstaluj zależności (cache layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopiuj kod aplikacji
COPY app/ ./app/

# Port serwera
EXPOSE 8000

# Katalog cache modelu HuggingFace (montowany jako volume)
ENV HF_HOME=/app/model_cache
ENV TRANSFORMERS_CACHE=/app/model_cache

# Domyślna konfiguracja
ENV MODEL_NAME=ProsusAI/finbert
ENV BATCH_SIZE=16
ENV MAX_TOKEN_LENGTH=512
ENV PORT=8000

# Health check — czy model jest załadowany
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Uruchom serwer
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
