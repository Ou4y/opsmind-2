"""Lightweight in-memory observability primitives."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from threading import RLock
from typing import Mapping


def _freeze_labels(labels: Mapping[str, str] | None) -> tuple[tuple[str, str], ...]:
    if not labels:
        return ()
    return tuple(sorted((str(k), str(v)) for k, v in labels.items()))


def _format_label_block(labels: tuple[tuple[str, str], ...]) -> str:
    if not labels:
        return ""
    parts = [f'{key}="{value}"' for key, value in labels]
    return "{" + ",".join(parts) + "}"


@dataclass
class HistogramSeries:
    observations: list[float] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.observations)

    @property
    def total(self) -> float:
        return float(sum(self.observations))


class InMemoryMetrics:
    """Simple metric sink with Prometheus text rendering."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._counters: defaultdict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
        self._histograms: defaultdict[tuple[str, tuple[tuple[str, str], ...]], HistogramSeries] = defaultdict(
            HistogramSeries
        )

    def inc(self, name: str, amount: float = 1.0, labels: Mapping[str, str] | None = None) -> None:
        key = (name, _freeze_labels(labels))
        with self._lock:
            self._counters[key] += float(amount)

    def observe(self, name: str, value: float, labels: Mapping[str, str] | None = None) -> None:
        key = (name, _freeze_labels(labels))
        with self._lock:
            self._histograms[key].observations.append(float(value))

    def snapshot(self) -> dict:
        with self._lock:
            counters = {
                f"{name}{_format_label_block(labels)}": value
                for (name, labels), value in self._counters.items()
            }
            histograms = {
                f"{name}{_format_label_block(labels)}": {
                    "count": series.count,
                    "sum": round(series.total, 6),
                }
                for (name, labels), series in self._histograms.items()
            }
        return {"counters": counters, "histograms": histograms}

    def render_prometheus(self) -> str:
        buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0]
        lines: list[str] = []
        with self._lock:
            for (name, labels), value in sorted(self._counters.items()):
                lines.append(f"{name}{_format_label_block(labels)} {value:.6f}")

            for (name, labels), series in sorted(self._histograms.items()):
                obs = list(series.observations)
                for upper in buckets:
                    count = sum(1 for item in obs if item <= upper)
                    bucket_labels = tuple(labels) + (("le", str(upper)),)
                    lines.append(f"{name}_bucket{_format_label_block(bucket_labels)} {count}")
                inf_labels = tuple(labels) + (("le", "+Inf"),)
                lines.append(f"{name}_bucket{_format_label_block(inf_labels)} {len(obs)}")
                lines.append(f"{name}_count{_format_label_block(labels)} {len(obs)}")
                lines.append(f"{name}_sum{_format_label_block(labels)} {sum(obs):.6f}")

        return "\n".join(lines) + ("\n" if lines else "")
