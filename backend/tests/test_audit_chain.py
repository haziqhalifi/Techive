"""FR-11 — the audit chain maths. Pure, so it is verified without a database."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.enums import AuditAction
from app.services.audit_service import (
    GENESIS_HASH,
    canonical_json,
    chain_hash,
    entry_fields,
    iso,
    verify_chain,
)

T0 = datetime(2026, 10, 2, 6, 40, 0, 123456, tzinfo=UTC)

EVENTS = [
    (AuditAction.CAPTURE, "pill", "pill-energy-chiller-drift", {"version": 2}),
    (AuditAction.APPROVE, "pill", "pill-energy-chiller-drift", {"version": 2, "note": "ok"}),
    (AuditAction.APPLY, "case", "case-0001", {"option_id": "opt-inspect-vav"}),
]


def _build_chain(events=EVENTS) -> list[dict]:
    entries: list[dict] = []
    prev = GENESIS_HASH
    for index, (action, entity_type, entity_id, payload) in enumerate(events):
        occurred = T0 + timedelta(seconds=index)
        fields = entry_fields(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=payload,
            occurred_at=occurred,
        )
        digest = chain_hash(prev, fields)
        entries.append({"seq": index + 1, "prev_hash": prev, "hash": digest, **fields})
        prev = digest
    return entries


def test_genesis_hash_is_sixty_four_zeros():
    assert GENESIS_HASH == "0" * 64
    assert len(GENESIS_HASH) == 64


def test_valid_chain_verifies():
    assert verify_chain(_build_chain()) == (True, None)


def test_empty_chain_is_valid():
    assert verify_chain([]) == (True, None)


def test_each_entry_links_to_the_previous_hash():
    chain = _build_chain()
    assert chain[0]["prev_hash"] == GENESIS_HASH
    assert chain[1]["prev_hash"] == chain[0]["hash"]
    assert chain[2]["prev_hash"] == chain[1]["hash"]


def test_tampering_with_payload_is_detected():
    chain = _build_chain()
    chain[1]["payload"] = {"version": 2, "note": "TAMPERED"}
    valid, broken_at = verify_chain(chain)
    assert valid is False
    assert broken_at == 2


def test_tampering_with_entity_is_detected():
    chain = _build_chain()
    chain[2]["entity_id"] = "case-9999"
    assert verify_chain(chain)[0] is False


def test_reordering_entries_breaks_the_chain():
    chain = _build_chain()
    chain[0], chain[1] = chain[1], chain[0]
    assert verify_chain(chain)[0] is False


def test_removing_a_middle_entry_breaks_the_chain():
    chain = _build_chain()
    del chain[1]
    assert verify_chain(chain)[0] is False


def test_canonical_json_is_key_order_independent():
    a = canonical_json({"b": 1, "a": 2})
    b = canonical_json({"a": 2, "b": 1})
    assert a == b


def test_iso_normalises_naive_and_aware_to_utc():
    naive = datetime(2026, 10, 2, 6, 40, 0)
    assert iso(naive).endswith("+00:00")
    assert iso(naive) == iso(naive.replace(tzinfo=UTC))


def test_hash_is_stable_across_calls():
    fields = entry_fields(
        action=AuditAction.CAPTURE,
        entity_type="pill",
        entity_id="p",
        payload={"v": 1},
        occurred_at=T0,
    )
    assert chain_hash(GENESIS_HASH, fields) == chain_hash(GENESIS_HASH, fields)
