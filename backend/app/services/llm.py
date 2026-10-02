"""The ONLY module permitted to talk to a language model.

The model's job is deliberately tiny: choose one pill ID from an approved candidate list.
It never writes guidance, never produces numbers, and never sees or returns free prose that
reaches the user. If the model is disabled, unreachable, or returns an ID outside the
candidate set, we fall back to a deterministic choice.

`tests/test_no_llm_in_deterministic.py` fails the build if any deterministic module imports
this module or a provider SDK.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("services.llm")

# Rationale codes the model may return. Free prose is never accepted.
ALLOWED_RATIONALE_CODES = {
    "single_approved_candidate",
    "zone_level_cause",
    "plant_drift_detected",
    "no_matching_candidate",
    "low_confidence",
}


@dataclass(frozen=True)
class SelectionResult:
    """The model's entire output surface."""

    selected_pill_id: str | None
    rationale_codes: list[str] = field(default_factory=list)
    source: str = "stub"  # "stub" | "llm" | "fallback"


def is_enabled() -> bool:
    return bool(get_settings().llm_enabled)


def _stub_select(candidate_ids: list[str]) -> SelectionResult:
    """Deterministic stand-in used in demos and CI — no API key required."""
    if not candidate_ids:
        return SelectionResult(None, ["no_matching_candidate"], "stub")
    if len(candidate_ids) == 1:
        return SelectionResult(candidate_ids[0], ["single_approved_candidate"], "stub")
    # Deterministic tie-break: first by sorted id, so runs are reproducible.
    return SelectionResult(sorted(candidate_ids)[0], ["single_approved_candidate"], "stub")


def _sanitise_codes(codes: Any) -> list[str]:
    if not isinstance(codes, list):
        return []
    return [code for code in codes if isinstance(code, str) and code in ALLOWED_RATIONALE_CODES]


def select_pill_by_id(
    *,
    complaint_text: str,
    signals: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> SelectionResult:
    """Choose one pill ID from `candidates`.

    The return value is validated: the ID must exist in the candidate set, otherwise the
    deterministic fallback is used. Numbers are never produced here — they come from
    app.services.analytics after selection.
    """
    candidate_ids = [str(c["id"]) for c in candidates]

    if not is_enabled():
        return _stub_select(candidate_ids)

    settings = get_settings()
    if not settings.openai_api_key:
        log.warning("LLM_ENABLED=true but no API key set — using deterministic stub")
        return _stub_select(candidate_ids)

    try:
        raw = _call_provider(settings, complaint_text, signals, candidates)
    except Exception as exc:  # noqa: BLE001 — a model failure must never break a case
        log.warning("model call failed ({}), using deterministic fallback", exc)
        return _stub_select(candidate_ids)

    chosen = raw.get("selected_pill_id")
    if chosen not in candidate_ids:
        log.warning(
            "model returned {!r}, which is not an approved candidate — falling back", chosen
        )
        return _stub_select(candidate_ids)

    return SelectionResult(str(chosen), _sanitise_codes(raw.get("rationale_codes")), "llm")


def _call_provider(
    settings: Any,
    complaint_text: str,
    signals: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Call any OpenAI-compatible chat-completions endpoint. 10s timeout, JSON only."""
    from app.agents.prompts import SELECTION_SYSTEM_PROMPT, build_selection_prompt

    base = (settings.openai_base_url or "https://api.openai.com/v1").rstrip("/")
    response = httpx.post(
        f"{base}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.openai_model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SELECTION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": build_selection_prompt(complaint_text, signals, candidates),
                },
            ],
        },
        timeout=10.0,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return json.loads(content)
