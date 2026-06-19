"""Persistent feedback/golden/cache store with atomic writes."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from typing import Any


class SpecFeedbackRepository:
    def __init__(self, feedback_path: Path, golden_path: Path, cache_path: Path) -> None:
        self.feedback_path = feedback_path
        self.golden_path = golden_path
        self.cache_path = cache_path
        self._lock = RLock()
        self._cache: dict[str, dict[str, Any]] = {}
        self._ensure_parent_paths()
        self.reload_cache()

    def _ensure_parent_paths(self) -> None:
        self.feedback_path.parent.mkdir(parents=True, exist_ok=True)
        self.golden_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            delete=False,
            dir=str(path.parent),
            prefix=f"{path.name}.tmp.",
            suffix=".json",
        ) as handle:
            json.dump(data, handle, ensure_ascii=True, indent=2)
            temp_path = Path(handle.name)
        temp_path.replace(path)

    @staticmethod
    def append_jsonl(path: Path, row: dict[str, Any]) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=True) + "\n")

    @staticmethod
    def read_jsonl(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        rows: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        rows.append(parsed)
                except json.JSONDecodeError:
                    continue
        return rows

    def reload_cache(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            if not self.cache_path.exists():
                self._cache = {}
                return {}
            try:
                with self.cache_path.open("r", encoding="utf-8") as handle:
                    data = json.load(handle)
                self._cache = data if isinstance(data, dict) else {}
            except Exception:
                self._cache = {}
            return dict(self._cache)

    def get_cache_entry(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            value = self._cache.get(key)
            if isinstance(value, dict):
                return dict(value)
            return None

    def upsert_cache_entry(self, key: str, entry: dict[str, Any]) -> None:
        with self._lock:
            self._cache[key] = dict(entry)
            self._atomic_write_json(self.cache_path, self._cache)

    def write_feedback(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.append_jsonl(self.feedback_path, row)

    def write_golden(self, row: dict[str, Any]) -> None:
        with self._lock:
            self.append_jsonl(self.golden_path, row)

    def read_golden(self) -> list[dict[str, Any]]:
        with self._lock:
            return self.read_jsonl(self.golden_path)

    def golden_size(self) -> int:
        return len(self.read_golden())
