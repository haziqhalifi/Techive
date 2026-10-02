"""Architecture guard: numbers and safety must never touch an LLM.

These modules are the determinism contract. If one of them ever imports a model SDK —
directly or transitively via app.services.llm — the whole governance story collapses.
This test fails CI if that happens.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# Modules that must stay pure / DB-only.
DETERMINISTIC_MODULES = [
    "services/analytics.py",
    "services/gate_service.py",
    "services/context_check.py",
    "services/audit_service.py",
    "services/pill_service.py",
]

# Model provider SDKs. These may only ever appear in services/llm.py.
MODEL_PROVIDER_ROOTS = {
    "openai",
    "anthropic",
    "langchain_openai",
    "langchain_anthropic",
    "litellm",
    "cohere",
    "transformers",
    "vertexai",
    "mistralai",
}

# Orchestration frameworks. These do not call a model themselves, so the graph may use
# them — but the deterministic modules must stay free of them too.
ORCHESTRATION_ROOTS = {"langgraph", "langchain", "langchain_core"}

# The one module allowed to talk to a model.
LLM_MODULE = "services/llm.py"


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if base:
                modules.add(base)
            for alias in node.names:
                modules.add(f"{base}.{alias.name}" if base else alias.name)
    return modules


def _forbidden_in_deterministic(module: str) -> bool:
    segments = module.split(".")
    if "llm" in segments:  # catches `app.services.llm` and a bare `llm`
        return True
    return segments[0] in MODEL_PROVIDER_ROOTS or segments[0] in ORCHESTRATION_ROOTS


@pytest.mark.parametrize("relative_path", DETERMINISTIC_MODULES)
def test_deterministic_module_has_no_llm_dependency(relative_path):
    path = APP_DIR / relative_path
    assert path.exists(), f"{relative_path} is missing from the determinism contract"

    offenders = sorted(m for m in _imported_modules(path) if _forbidden_in_deterministic(m))
    assert not offenders, (
        f"{relative_path} must not depend on an LLM or agent framework, but imports: "
        f"{offenders}. Numbers and safety are computed in code — move model calls to "
        "services/llm.py."
    )


def test_only_llm_module_imports_a_provider_sdk():
    """Scan every app module: provider SDKs may appear only in services/llm.py."""
    offenders: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        relative = path.relative_to(APP_DIR).as_posix()
        if relative == LLM_MODULE:
            continue
        providers = {m for m in _imported_modules(path) if m.split(".")[0] in MODEL_PROVIDER_ROOTS}
        if providers:
            offenders.append(f"{relative} -> {sorted(providers)}")

    assert (
        not offenders
    ), "Only services/llm.py may import a model provider SDK. Offenders: " + "; ".join(offenders)
