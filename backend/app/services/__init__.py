"""Business logic layer.

The determinism contract lives here: `analytics`, `gate_service`, `context_check`,
`audit_service` and `pill_service` are pure or DB-only and MUST NOT import an LLM.
Only `llm.py` may talk to a model. This is enforced by
tests/test_no_llm_in_deterministic.py.
"""
