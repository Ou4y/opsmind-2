"""Shared typing contract for pluggable LLM backends."""

from __future__ import annotations

from typing import Any, Protocol


class LLMClientProtocol(Protocol):
    @property
    def model(self) -> str: ...

    @property
    def enabled(self) -> bool: ...

    @property
    def status(self) -> str: ...

    @property
    def last_error(self) -> str: ...

    def generate_json(
        self,
        prompt: str,
        schema: dict[str, Any],
        temperature: float = 0.2,
    ) -> dict[str, Any] | None: ...
