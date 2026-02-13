"""
FinBERT Sidecar — FastAPI mikroserwis do analizy sentymentu tekstów finansowych.

Endpointy:
  GET  /health          — status serwisu i modelu
  POST /api/sentiment   — analiza pojedynczego tekstu
  POST /api/sentiment/batch — analiza wielu tekstów (do BATCH_SIZE na raz)

Konfiguracja przez zmienne środowiskowe:
  MODEL_NAME       — nazwa modelu HuggingFace (default: ProsusAI/finbert)
  MAX_TOKEN_LENGTH — max długość tokenów (default: 512)
  BATCH_SIZE       — max tekstów w batch (default: 16, laptop: 8, RTX 6000: 64)
  PORT             — port serwera (default: 8000)
"""

import os
import time
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.model import FinBERTModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("finbert-sidecar")

# Konfiguracja
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "16"))

# Globalny model — ładowany raz przy starcie
finbert = FinBERTModel()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Ładowanie modelu przy starcie serwera."""
    start = time.time()
    finbert.load()
    elapsed = time.time() - start
    logger.info("Model gotowy w %.1fs", elapsed)
    yield
    logger.info("Zamykanie serwisu...")


app = FastAPI(
    title="FinBERT Sidecar",
    description="Mikroserwis analizy sentymentu tekstów finansowych (ProsusAI/finbert)",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Modele request/response ──────────────────────────────

class SentimentRequest(BaseModel):
    """Pojedynczy tekst do analizy."""
    text: str = Field(..., min_length=1, max_length=5000, description="Tekst do analizy sentymentu")


class SentimentResponse(BaseModel):
    """Wynik analizy sentymentu."""
    label: str = Field(..., description="positive / negative / neutral")
    score: float = Field(..., description="Score od -1.0 (bearish) do +1.0 (bullish)")
    confidence: float = Field(..., description="Pewność predykcji 0.0-1.0")
    probabilities: dict[str, float] = Field(..., description="Prawdopodobieństwa per klasa")
    processing_time_ms: float = Field(..., description="Czas przetwarzania w ms")


class BatchRequest(BaseModel):
    """Lista tekstów do analizy batch."""
    texts: list[str] = Field(
        ...,
        min_length=1,
        max_length=BATCH_SIZE,
        description=f"Lista tekstów (max {BATCH_SIZE})",
    )


class BatchResponse(BaseModel):
    """Wyniki batch analizy."""
    results: list[SentimentResponse]
    total_processing_time_ms: float
    batch_size: int


class HealthResponse(BaseModel):
    """Status serwisu."""
    status: str
    model_loaded: bool
    device: dict
    config: dict


# ── Endpointy ────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    """Status serwisu, modelu i GPU."""
    return HealthResponse(
        status="healthy" if finbert.is_loaded else "loading",
        model_loaded=finbert.is_loaded,
        device=finbert.device_info,
        config={
            "batch_size": BATCH_SIZE,
            "max_token_length": finbert.max_length,
            "model_name": finbert.model_name,
        },
    )


@app.post("/api/sentiment", response_model=SentimentResponse)
async def predict_sentiment(request: SentimentRequest):
    """Analiza sentymentu pojedynczego tekstu."""
    if not finbert.is_loaded:
        raise HTTPException(status_code=503, detail="Model jeszcze się ładuje")

    start = time.time()
    result = finbert.predict(request.text)
    elapsed_ms = (time.time() - start) * 1000

    return SentimentResponse(
        **result,
        processing_time_ms=round(elapsed_ms, 2),
    )


@app.post("/api/sentiment/batch", response_model=BatchResponse)
async def predict_batch(request: BatchRequest):
    """Batch analiza sentymentu (do BATCH_SIZE tekstów)."""
    if not finbert.is_loaded:
        raise HTTPException(status_code=503, detail="Model jeszcze się ładuje")

    if len(request.texts) > BATCH_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Max {BATCH_SIZE} tekstów per batch (otrzymano {len(request.texts)})",
        )

    start = time.time()
    results = finbert.predict_batch(request.texts)
    elapsed_ms = (time.time() - start) * 1000

    return BatchResponse(
        results=[
            SentimentResponse(**r, processing_time_ms=round(elapsed_ms / len(results), 2))
            for r in results
        ],
        total_processing_time_ms=round(elapsed_ms, 2),
        batch_size=len(results),
    )
