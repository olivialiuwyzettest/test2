from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str
    page: Optional[int] = None


class Comparison(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["WoW", "YoY", "vs_target", "vs_prior_period"]
    delta_abs: Optional[str] = None
    delta_pct: Optional[str] = None
    prior_value: Optional[str] = None


class Metric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    value: str = ""
    unit: str = ""
    directionality: Literal["higher_is_better", "lower_is_better", "unknown"] = "unknown"
    comparisons: list[Comparison] = Field(default_factory=list)


class AssetExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str
    source_type: Literal["image", "pdf_page"]
    source_ref: SourceRef
    dashboard_title: str = ""
    time_range: str = ""
    metrics: list[Metric] = Field(default_factory=list)
    notable_trends: list[str] = Field(default_factory=list)
    anomalies: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    raw_evidence_notes: list[str] = Field(default_factory=list)


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str
    filename: str
    page: Optional[int] = None
    thumbnail_crop: Optional[str] = None
    note: Optional[str] = None


class Insight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    topic: str
    headline: str
    what_changed: list[str]
    why_it_matters: list[str]
    discussion_questions: list[str]
    metrics_mentioned: list[str] = Field(default_factory=list)
    evidence: list[Evidence]
    labels: list[Literal["supported", "hypothesis", "needs_data"]] = Field(default_factory=list)
    importance_score: int = Field(ge=0, le=100, default=0)


class InsightsDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    week: str
    generated_at: str
    input_summary: dict
    topics: list[str]
    insights: list[Insight]
    all_metrics: dict
    assets: list[dict]
    relationships: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

