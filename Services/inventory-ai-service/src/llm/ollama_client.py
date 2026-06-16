"""Ollama client wrapper used by service modules."""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
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
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_seconds: int = 120,
        keep_alive: str = "10m",
        retry_attempts: int = 1,
    ) -> None:
        self._base_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        self._model = (model or "gemma3:4b").strip() or "gemma3:4b"
        self._timeout_seconds = max(3, int(timeout_seconds))
        self._keep_alive = str(keep_alive or "").strip() or "10m"
        self._retry_attempts = max(0, min(3, int(retry_attempts)))
        self._last_error: str = ""
        self._blocked_until_epoch: float = 0.0
        self._last_success_epoch: float | None = None
        self._last_checked_epoch: float | None = None
        self._last_failure_epoch: float | None = None
        self._consecutive_failures: int = 0
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
    def timeout_seconds(self) -> int:
        return self._timeout_seconds

    @property
    def keep_alive(self) -> str:
        return self._keep_alive

    @property
    def retry_attempts(self) -> int:
        return self._retry_attempts

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

    @staticmethod
    def _epoch_to_iso(value: float | None) -> str | None:
        if value is None:
            return None
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except Exception:
            return None

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

    @staticmethod
    def _is_timeout_like_error(text: str) -> bool:
        normalized = str(text or "").lower()
        return (
            "timed out" in normalized
            or "timeout" in normalized
            or "readtimeout" in normalized
            or "connecttimeout" in normalized
        )

    @staticmethod
    def _is_network_like_error(text: str) -> bool:
        normalized = str(text or "").lower()
        return (
            "connection refused" in normalized
            or "name or service not known" in normalized
            or "temporary failure" in normalized
            or "network" in normalized
            or "connection reset" in normalized
            or "dns" in normalized
        )

    def _mark_success(self) -> None:
        self._last_error = ""
        self._blocked_until_epoch = 0.0
        self._last_success_epoch = time.time()
        self._consecutive_failures = 0

    def _mark_failure(self, error_text: str, apply_cooldown: bool = True) -> None:
        self._last_error = str(error_text or "unknown_error")
        self._last_failure_epoch = time.time()
        self._consecutive_failures += 1
        if apply_cooldown:
            self._apply_cooldown_from_error(self._last_error)
        else:
            self._blocked_until_epoch = 0.0

    def list_models(self) -> list[str] | None:
        if not self.enabled:
            return None
        self._last_checked_epoch = time.time()
        try:
            response = self._client.get(f"{self._base_url}/api/tags")
            response.raise_for_status()
            payload = response.json()
            models = payload.get("models") if isinstance(payload, dict) else None
            if not isinstance(models, list):
                return []
            names: list[str] = []
            for entry in models:
                if isinstance(entry, dict):
                    name = str(entry.get("name") or "").strip()
                    if name:
                        names.append(name)
            return names
        except Exception as exc:
            self._last_error = str(exc)
            logger.warning("Ollama list_models failed: %s", exc)
            return None

    def diagnostics(self) -> dict[str, Any]:
        model_names = self.list_models()
        tags_reachable = model_names is not None
        selected_model = self._model
        selected_model_present = bool(model_names and selected_model in model_names) if tags_reachable else None
        return {
            "llm_provider": "ollama",
            "llm_model": self._model,
            "ollama_base_url": self._base_url,
            "timeout_seconds": self._timeout_seconds,
            "keep_alive": self._keep_alive,
            "retry_attempts": self._retry_attempts,
            "llm_status": self.status,
            "llm_last_error": self._last_error or None,
            "last_success_at": self._epoch_to_iso(self._last_success_epoch),
            "last_checked_at": self._epoch_to_iso(self._last_checked_epoch),
            "last_failure_at": self._epoch_to_iso(self._last_failure_epoch),
            "consecutive_failures": int(self._consecutive_failures),
            "ollama_tags_reachable": tags_reachable,
            "selected_model_present": selected_model_present,
            "available_models_sample": (model_names or [])[:20] if tags_reachable else [],
        }

    def warmup(self, prompt: str = "Say OK only.") -> bool:
        schema = {
            "type": "object",
            "properties": {
                "status": {"type": "string"},
            },
            "required": ["status"],
        }
        parsed = self.generate_json(
            f'{prompt}\nRespond as strict JSON only: {{"status":"OK"}}',
            schema=schema,
            temperature=0.0,
        )
        status = str((parsed or {}).get("status") or "").strip().upper()
        return status == "OK"

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

        schema_props = (schema or {}).get("properties") if isinstance(schema, dict) else {}
        schema_keys = [
            str(key).strip()
            for key in (schema_props.keys() if isinstance(schema_props, dict) else [])
            if str(key).strip()
        ]
        schema_hint = ""
        if schema_keys:
            schema_hint = (
                "\nReturn exactly one JSON object with these top-level keys: "
                + ", ".join(schema_keys[:24])
                + "."
            )

        payload = {
            "model": self._model,
            "prompt": f"{str(prompt or '').rstrip()}{schema_hint}\nDo not include markdown or code fences.",
            "stream": False,
            "keep_alive": self._keep_alive,
            "format": "json",
            "options": {
                "temperature": float(temperature),
            },
        }

        attempts = 1 + self._retry_attempts
        for attempt in range(1, attempts + 1):
            self._last_checked_epoch = time.time()
            try:
                response = self._client.post(f"{self._base_url}/api/generate", json=payload)
                response.raise_for_status()
                envelope = response.json()
                raw_output = envelope.get("response")
                if not isinstance(raw_output, str) or not raw_output.strip():
                    message = "Ollama returned empty response body"
                    can_retry = attempt < attempts
                    self._mark_failure(message, apply_cooldown=not can_retry)
                    logger.warning(
                        "Ollama generate_json empty response (attempt %s/%s, retry=%s)",
                        attempt,
                        attempts,
                        can_retry,
                    )
                    if can_retry:
                        time.sleep(min(2.0, 0.3 * attempt))
                        continue
                    return None
                parsed = _extract_first_json_object(raw_output)
                if not isinstance(parsed, dict):
                    message = "Ollama returned unparsable or non-object JSON payload"
                    can_retry = attempt < attempts
                    self._mark_failure(message, apply_cooldown=not can_retry)
                    logger.warning(
                        "Ollama generate_json unparsable payload (attempt %s/%s, retry=%s)",
                        attempt,
                        attempts,
                        can_retry,
                    )
                    if can_retry:
                        time.sleep(min(2.0, 0.3 * attempt))
                        continue
                    return None
                self._mark_success()
                return parsed
            except Exception as exc:
                message = str(exc)
                timeout_like = self._is_timeout_like_error(message)
                network_like = self._is_network_like_error(message)
                can_retry = attempt < attempts and (timeout_like or network_like)
                self._mark_failure(message, apply_cooldown=not can_retry)
                logger.warning(
                    "Ollama generate_json failed (attempt %s/%s, retry=%s): %s",
                    attempt,
                    attempts,
                    can_retry,
                    exc,
                )
                if can_retry:
                    # Short backoff helps when the first call is a cold model wake-up.
                    time.sleep(min(2.0, 0.3 * attempt))
                    continue
                return None
        return None

    def generate_stream(
        self,
        prompt: str,
        temperature: float = 0.1,
    ):
        """Yield Ollama text chunks for streaming UI flows.

        This intentionally does not use JSON mode. Narrative assistant answers are
        much faster and more reliable when Gemma can emit plain text chunks.
        """
        if time.time() < self._blocked_until_epoch:
            return
        if not self.enabled:
            return

        payload = {
            "model": self._model,
            "prompt": str(prompt or "").rstrip(),
            "stream": True,
            "keep_alive": self._keep_alive,
            "options": {
                "temperature": float(temperature),
                "num_predict": 360,
            },
        }

        self._last_checked_epoch = time.time()
        saw_chunk = False
        try:
            with self._client.stream("POST", f"{self._base_url}/api/generate", json=payload) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line:
                        continue
                    try:
                        envelope = json.loads(line)
                    except Exception:
                        continue
                    chunk = envelope.get("response")
                    if isinstance(chunk, str) and chunk:
                        saw_chunk = True
                        yield chunk
                    if envelope.get("done"):
                        break
            self._mark_success()
            if not saw_chunk:
                logger.warning("Ollama generate_stream completed without text chunks.")
        except Exception as exc:
            message = str(exc)
            self._mark_failure(message, apply_cooldown=True)
            logger.warning("Ollama generate_stream failed: %s", exc)
            raise
