"""FR-02 — a non-unknown claim without a real source excerpt must be rejected."""

from __future__ import annotations

import pytest

from app.core.errors import ValidationFailure
from app.models.enums import ClaimKind
from app.models.pill import Claim
from app.services.pill_service import assert_author_cannot_approve, validate_claims


def test_grounded_fact_is_accepted():
    validate_claims(
        [Claim(kind=ClaimKind.FACT, text="Zone faults are downstream.", source_excerpt_id="ex-4")]
    )


def test_unknown_may_have_no_source():
    validate_claims([Claim(kind=ClaimKind.UNKNOWN, text="The exact lease band.")])


def test_fact_without_source_is_rejected():
    with pytest.raises(ValidationFailure) as exc:
        validate_claims([Claim(kind=ClaimKind.FACT, text="Invented fact.")])
    assert exc.value.code == "validation_failure"
    assert exc.value.details["offending_claims"] == ["Invented fact."]


@pytest.mark.parametrize("kind", [ClaimKind.FACT, ClaimKind.INTERPRETATION, ClaimKind.ACTION])
def test_every_grounded_kind_requires_a_source(kind):
    with pytest.raises(ValidationFailure):
        validate_claims([Claim(kind=kind, text="No source attached.")])


def test_validation_reports_every_offender():
    with pytest.raises(ValidationFailure) as exc:
        validate_claims(
            [
                Claim(kind=ClaimKind.FACT, text="A"),
                Claim(kind=ClaimKind.FACT, text="B", source_excerpt_id="ex-1"),
                Claim(kind=ClaimKind.ACTION, text="C"),
            ]
        )
    assert exc.value.details["offending_claims"] == ["A", "C"]


# ---------------------------------------------------------------- FR-03
def test_author_cannot_approve_own_pill():
    with pytest.raises(ValidationFailure) as exc:
        assert_author_cannot_approve(
            "22222222-2222-2222-2222-222222222222", "22222222-2222-2222-2222-222222222222"
        )
    assert "FR-03" in exc.value.message


def test_different_reviewer_may_approve():
    assert_author_cannot_approve(
        "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
    )


def test_missing_actor_does_not_block():
    assert_author_cannot_approve("22222222-2222-2222-2222-222222222222", None)
