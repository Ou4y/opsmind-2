"""Ollama client wrapper used by service modules."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import httpx


logger = logging.getLogger(__name__)


def _extract_first_json_object(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


class OllamaClient:
    def __init__(self, base_url: str, model: str, timeout_seconds: int = 45) -> None:
        self._base_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        self._model = (model or "gemma3:4b").strip() or "gemma3:4b"
        self._timeout_seconds = max(3, int(timeout_seconds))
        self._last_error: str = ""
        self._blocked_until_epoch: float = 0.0
        self._client = httpx.Client(timeout=httpx.Timeout(float(self._timeout_seconds)))

    def close(self) -> None:
        self._client.close()

    @property
    def model(self) -> str:
        return self._model

    @property
    def enabled(self) -> bool:
        return bool(self._base_url and self._model)

    @property
    def last_error(self) -> str:
        return self._last_error

    @property
    def status(self) -> str:
        if not self.enabled:
            return "disabled"
        if time.time() < self._blocked_until_epoch:
            return "cooldown"
        if not self._last_error:
            return "ready"
        raw = self._last_error.upper()
        if "404" in raw and "MODEL" in raw:
            return "model_missing"
        if "429" in raw:
            return "rate_limited"
        return "error"

    def _apply_cooldown_from_error(self, error_text: str) -> None:
        now = time.time()
        text = str(error_text or "")
        upper = text.upper()
        if "429" in upper or "RATE" in upper:
            retry = re.search(r"retry in\s+([0-9]+(?:\.[0-9]+)?)s", text, flags=re.IGNORECASE)
            wait_seconds = max(2.0, float(retry.group(1))) if retry else 10.0
            self._blocked_until_epoch = now + wait_seconds
            return
        self._blocked_until_epoch = now + 3.0

    def generate_json(
        self,
        prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.2,
    ) -> dict[str, Any] | None:
        if time.time() < self._blocked_until_epoch:
            return None
        if not self.enabled:
            return None

        payload = {
            "model": self._model,
            "prompt": prompt,
            "stream": False,
            # Use schema-constrained generation where supported by Ollama.
            "format": schema if isinstance(schema, dict) and schema else "json",
            "options": {
                "temperature": float(temperature),
            },
        }

        try:
            response = self._client.post(f"{self._base_url}/api/generate", json=payload)
            response.raise_for_status()
            envelope = response.json()
            raw_output = envelope.get("response")
            if not isinstance(raw_output, str) or not raw_output.strip():
                self._last_error = "Ollama returned empty response body"
                return None
            parsed = _extract_first_json_object(raw_output)
            if not isinstance(parsed, dict):
                self._last_error = "Ollama returned unparsable or non-object JSON payload"
                return None
            self._last_error = ""
            self._blocked_until_epoch = 0.0
            return parsed
        except Exception as exc:
            self._last_error = str(exc)
            self._apply_cooldown_from_error(self._last_error)
            logger.warning("Ollama generate_json failed: %s", exc)
            return None
