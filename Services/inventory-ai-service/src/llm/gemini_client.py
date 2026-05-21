"""Gemini client wrapper used by service modules."""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

from google import genai


logger = logging.getLogger(__name__)


class GeminiClient:
    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = (api_key or "").strip()
        self._model = (model or "gemini-2.0-flash").strip() or "gemini-2.0-flash"
        self._client: genai.Client | None = None
        self._last_error: str = ""
        self._blocked_until_epoch: float = 0.0

    @property
    def model(self) -> str:
        return self._model

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    @property
    def last_error(self) -> str:
        return self._last_error

    @property
    def status(self) -> str:
        if not self.enabled:
            return "disabled"
        if time.time() < self._blocked_until_epoch:
            raw = self._last_error.upper()
            if "PERMISSION_DENIED" in raw:
                return "permission_denied_cooldown"
            if "RESOURCE_EXHAUSTED" in raw or "QUOTA" in raw:
                return "quota_exhausted_cooldown"
            return "cooldown"
        if not self._last_error:
            return "ready"
        raw = self._last_error.upper()
        if "PERMISSION_DENIED" in raw:
            return "permission_denied"
        if "RESOURCE_EXHAUSTED" in raw or "QUOTA" in raw:
            return "quota_exhausted"
        return "error"

    def _get_client(self) -> genai.Client | None:
        if not self.enabled:
            return None
        if self._client is None:
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    def _apply_cooldown_from_error(self, error_text: str) -> None:
        upper = error_text.upper()
        now = time.time()

        # Permanent/auth-like failures: stop retrying aggressively.
        if "PERMISSION_DENIED" in upper:
            self._blocked_until_epoch = now + (6 * 60 * 60)
            return

        # Quota/rate failures: honor retry hint if present, otherwise back off.
        if "RESOURCE_EXHAUSTED" in upper or "QUOTA" in upper:
            retry = re.search(r"retry in\s+([0-9]+(?:\.[0-9]+)?)s", error_text, flags=re.IGNORECASE)
            if retry:
                wait_seconds = max(5.0, float(retry.group(1)))
            else:
                wait_seconds = 60.0
            self._blocked_until_epoch = now + wait_seconds
            return

    def generate_json(
        self,
        prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.2,
    ) -> dict[str, Any] | None:
        if time.time() < self._blocked_until_epoch:
            return None

        client = self._get_client()
        if client is None:
            return None
        try:
            response = client.models.generate_content(
                model=self._model,
                contents=prompt,
                config={
                    "temperature": temperature,
                    "response_mime_type": "application/json",
                    "response_schema": schema,
                },
            )
            text = getattr(response, "text", None)
            if not text:
                return None
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                self._last_error = ""
                self._blocked_until_epoch = 0.0
                return parsed
            self._last_error = "Invalid non-object JSON payload from Gemini"
            return None
        except Exception as exc:
            self._last_error = str(exc)
            self._apply_cooldown_from_error(self._last_error)
            logger.warning("Gemini generate_json failed: %s", exc)
            return None
