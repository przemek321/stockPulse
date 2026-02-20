"""
Moduł ładowania i inference modelu FinBERT.

FinBERT (ProsusAI/finbert) to model BERT wytrenowany na tekstach finansowych.
Zwraca sentiment: positive/negative/neutral z confidence score.
Działa na GPU (CUDA) jeśli dostępne, w przeciwnym razie na CPU.
"""

from __future__ import annotations

import os
import logging
from typing import Optional

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

logger = logging.getLogger(__name__)

# Mapowanie etykiet FinBERT na score numeryczny (-1.0 do +1.0)
LABEL_SCORE_MAP = {
    "positive": 1.0,
    "negative": -1.0,
    "neutral": 0.0,
}


class FinBERTModel:
    """Wrapper na model FinBERT z batch inference."""

    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.device = None
        self.max_length = int(os.getenv("MAX_TOKEN_LENGTH", "512"))
        self.model_name = os.getenv("MODEL_NAME", "ProsusAI/finbert")

    def load(self) -> None:
        """Ładuje model i tokenizer do pamięci (GPU/CPU)."""
        logger.info("Ładowanie modelu %s...", self.model_name)

        # Wybór urządzenia: CUDA > CPU
        if torch.cuda.is_available():
            self.device = torch.device("cuda")
            gpu_name = torch.cuda.get_device_name(0)
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            logger.info("GPU: %s (%.1f GB VRAM)", gpu_name, vram_gb)
        else:
            self.device = torch.device("cpu")
            logger.warning("CUDA niedostępne — FinBERT działa na CPU (wolniej)")

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(self.model_name)
        self.model.to(self.device)
        self.model.eval()

        logger.info(
            "Model załadowany na %s (max_length=%d)",
            self.device,
            self.max_length,
        )

    def predict(self, text: str) -> dict:
        """Pojedyncza predykcja sentiment dla tekstu."""
        results = self.predict_batch([text])
        return results[0]

    @torch.no_grad()
    def predict_batch(self, texts: list[str]) -> list[dict]:
        """
        Batch predykcja sentiment dla listy tekstów.

        Zwraca listę dict:
          - label: "positive" | "negative" | "neutral"
          - score: float od -1.0 do +1.0 (ważony confidence)
          - confidence: float 0.0-1.0
          - probabilities: dict z prawdopodobieństwami per klasa
        """
        if not texts:
            return []

        inputs = self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt",
        ).to(self.device)

        outputs = self.model(**inputs)
        probabilities = torch.nn.functional.softmax(outputs.logits, dim=-1)

        # FinBERT labels: [positive, negative, neutral]
        labels = self.model.config.id2label
        results = []

        for probs in probabilities:
            prob_dict = {labels[i]: probs[i].item() for i in range(len(labels))}

            # Najwyższe prawdopodobieństwo = label
            best_label = max(prob_dict, key=prob_dict.get)
            confidence = prob_dict[best_label]

            # Score: ważona kombinacja positive - negative
            score = (
                prob_dict.get("positive", 0.0) * LABEL_SCORE_MAP["positive"]
                + prob_dict.get("negative", 0.0) * LABEL_SCORE_MAP["negative"]
                + prob_dict.get("neutral", 0.0) * LABEL_SCORE_MAP["neutral"]
            )

            results.append({
                "label": best_label,
                "score": round(score, 4),
                "confidence": round(confidence, 4),
                "probabilities": {k: round(v, 4) for k, v in prob_dict.items()},
            })

        return results

    @property
    def is_loaded(self) -> bool:
        return self.model is not None

    @property
    def device_info(self) -> dict:
        """Informacje o urządzeniu do health check."""
        info = {
            "device": str(self.device) if self.device else "not_loaded",
            "model": self.model_name,
            "max_length": self.max_length,
        }
        if self.device and self.device.type == "cuda":
            info["gpu_name"] = torch.cuda.get_device_name(0)
            info["vram_total_gb"] = round(
                torch.cuda.get_device_properties(0).total_memory / (1024 ** 3), 1
            )
            info["vram_used_gb"] = round(
                torch.cuda.memory_allocated(0) / (1024 ** 3), 2
            )
        return info
