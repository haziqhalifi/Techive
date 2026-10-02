"""Capture-side models: the transcript excerpts every pill claim traces back to."""

from __future__ import annotations

from datetime import datetime

from app.models.common import ApiModel


class TranscriptExcerpt(ApiModel):
    id: str  # e.g. 'ex-4'
    interview_id: str
    speaker: str
    occurred_at: datetime
    text: str
