"""Base model shared by all API schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

DATA_NOTICE = "synthetic data"


class ApiModel(BaseModel):
    """Base for every request/response model.

    `populate_by_name` lets us build models from both field names and aliases;
    `from_attributes` lets us construct them straight from DB rows.
    """

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        extra="ignore",
        str_strip_whitespace=True,
    )
