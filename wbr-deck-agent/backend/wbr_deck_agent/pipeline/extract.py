from __future__ import annotations

import base64
import io
import json
import math
from pathlib import Path
import threading
from typing import Any

from wbr_deck_agent.core.config import Settings
from wbr_deck_agent.pipeline.schemas import AssetExtraction, SourceRef

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None  # type: ignore[assignment]


# Anthropic enforces a 5 MiB max on the *base64 field* for images.
# Base64 expands 3 bytes -> 4 chars, so keep raw bytes under 3 * floor(limit/4).
ANTHROPIC_IMAGE_MAX_B64_BYTES = 5 * 1024 * 1024
ANTHROPIC_IMAGE_MAX_BYTES = 3 * (ANTHROPIC_IMAGE_MAX_B64_BYTES // 4)


def _mime_for_image(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".png":
        return "image/png"
    if suf in (".jpg", ".jpeg"):
        return "image/jpeg"
    # Best-effort default; OpenAI accepts many common image types.
    return "application/octet-stream"


def _asset_extraction_schema() -> dict[str, Any]:
    # Hand-written JSON Schema (avoid $ref/$defs surprises).
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "asset_id": {"type": "string"},
            "source_type": {"type": "string", "enum": ["image", "pdf_page"]},
            "source_ref": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "filename": {"type": "string"},
                    "page": {"type": ["integer", "null"]},
                },
                "required": ["filename", "page"],
            },
            "dashboard_title": {"type": "string"},
            "time_range": {"type": "string"},
            "metrics": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "name": {"type": "string"},
                        "value": {"type": "string"},
                        "unit": {"type": "string"},
                        "directionality": {
                            "type": "string",
                            "enum": ["higher_is_better", "lower_is_better", "unknown"],
                        },
                        "comparisons": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "type": {
                                        "type": "string",
                                        "enum": ["WoW", "YoY", "vs_target", "vs_prior_period"],
                                    },
                                    "delta_abs": {"type": ["string", "null"]},
                                    "delta_pct": {"type": ["string", "null"]},
                                    "prior_value": {"type": ["string", "null"]},
                                },
                                "required": ["type", "delta_abs", "delta_pct", "prior_value"],
                            },
                        },
                    },
                    "required": ["name", "value", "unit", "directionality", "comparisons"],
                },
            },
            "notable_trends": {"type": "array", "items": {"type": "string"}},
            "anomalies": {"type": "array", "items": {"type": "string"}},
            "tags": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "raw_evidence_notes": {"type": "array", "items": {"type": "string"}},
        },
        "required": [
            "asset_id",
            "source_type",
            "source_ref",
            "dashboard_title",
            "time_range",
            "metrics",
            "notable_trends",
            "anomalies",
            "tags",
            "confidence",
            "raw_evidence_notes",
        ],
    }


def _mock_tags_from_filename(filename: str) -> list[str]:
    f = filename.lower()
    tags: list[str] = []
    if "rev" in f or "revenue" in f or "gmv" in f:
        tags.append("revenue")
    if "margin" in f or "gross" in f:
        tags.append("margin")
    if "sub" in f or "subscription" in f:
        tags.append("subscriptions")
    if "engage" in f or "active" in f or "dau" in f or "mau" in f:
        tags.append("engagement")
    if "traffic" in f or "visit" in f or "session" in f:
        tags.append("traffic")
    if "conv" in f or "conversion" in f:
        tags.append("conversion")
    return tags[:6]


def _rgba_to_rgb_on_white(im: "Image.Image") -> "Image.Image":
    if Image is None:  # pragma: no cover
        raise RuntimeError("Pillow is required for image preprocessing.")

    if im.mode == "RGB":
        return im
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    return im.convert("RGB")


def _encode_jpeg_bytes(im: "Image.Image", *, quality: int) -> bytes:
    if Image is None:  # pragma: no cover
        raise RuntimeError("Pillow is required for image preprocessing.")

    buf = io.BytesIO()
    # progressive+optimize usually reduce size; safe defaults for screenshots.
    im.save(buf, format="JPEG", quality=int(quality), optimize=True, progressive=True)
    return buf.getvalue()


def _prepare_image_bytes_for_anthropic(image_path: Path) -> tuple[str, bytes]:
    """
    Anthropic Messages API enforces a 5 MiB max on the base64-encoded image field.

    If the input image exceeds the limit, we downscale/re-encode to JPEG until the
    base64 payload will fit.
    """
    raw = image_path.read_bytes()
    mime = _mime_for_image(image_path)
    if mime in ("image/png", "image/jpeg") and len(raw) <= ANTHROPIC_IMAGE_MAX_BYTES:
        return mime, raw

    if Image is None:
        raise RuntimeError(
            "Image exceeds Anthropic size limit and Pillow is unavailable for preprocessing. "
            "Install Pillow or export the dashboard at a smaller resolution."
        )

    with Image.open(image_path) as im0:
        im0.load()
        im = _rgba_to_rgb_on_white(im0)

    w, h = im.size
    longest = max(w, h)

    # Heuristic starting point: keep as much resolution as possible.
    if len(raw) > 0:
        ratio = ANTHROPIC_IMAGE_MAX_BYTES / len(raw)
    else:
        ratio = 0.5
    ratio = max(0.2, min(1.0, ratio))
    start_longest = int(math.floor(longest * math.sqrt(ratio)))
    start_longest = max(1200, min(longest, start_longest))

    qualities = [90, 85, 80, 75, 70, 65, 60, 55, 50, 45]
    longest_dim = start_longest

    for _round in range(12):
        im2 = im.copy()
        if max(im2.size) > longest_dim:
            im2.thumbnail((longest_dim, longest_dim))
        for q in qualities:
            b = _encode_jpeg_bytes(im2, quality=q)
            if len(b) <= ANTHROPIC_IMAGE_MAX_BYTES:
                return "image/jpeg", b
        # If still too large, reduce resolution and try again.
        longest_dim = int(longest_dim * 0.85)
        if longest_dim < 640:
            break

    raise RuntimeError(
        "Unable to shrink image under Anthropic 5 MiB base64 limit. "
        "Try exporting the dashboard at a smaller resolution or as a PDF."
    )


def extract_asset(
    *,
    settings: Settings,
    image_path: Path,
    asset_id: str,
    source_type: str,
    source_ref: SourceRef,
) -> AssetExtraction:
    """
    Extract per-asset structured data.

    Strict grounding:
    - Values are strings; the model is instructed to only include numbers that are visible.
    - In mock mode, no numbers are emitted (forces downstream to label as [NEEDS DATA]).
    """
    if settings.effective_mock_mode():
        return AssetExtraction(
            asset_id=asset_id,
            source_type="pdf_page" if source_type == "pdf_page" else "image",
            source_ref=source_ref,
            dashboard_title="",
            time_range="",
            metrics=[],
            notable_trends=["[NEEDS DATA] Mock mode: no vision extraction performed."],
            anomalies=[],
            tags=_mock_tags_from_filename(source_ref.filename),
            confidence=0.1,
            raw_evidence_notes=[
                "Mock mode enabled (no API call).",
                f"Asset: {source_ref.filename}"
                + (f" page {source_ref.page}" if source_ref.page else ""),
            ],
        )

    provider = settings.effective_provider()
    if provider == "anthropic":
        return _extract_anthropic(
            settings=settings,
            image_path=image_path,
            asset_id=asset_id,
            source_type=source_type,
            source_ref=source_ref,
        )

    return _extract_openai(
        settings=settings,
        image_path=image_path,
        asset_id=asset_id,
        source_type=source_type,
        source_ref=source_ref,
    )


def _common_prompt(asset_id: str, source_ref: SourceRef) -> str:
    return (
        "You are extracting facts from a Tableau dashboard screenshot.\n"
        "Return STRICT JSON that matches the provided JSON Schema.\n"
        "Rules:\n"
        "- Only include numbers/values that are directly visible in the image.\n"
        "- Do NOT invent deltas, percentages, targets, or time ranges.\n"
        "- If uncertain, leave fields empty or use empty arrays.\n"
        "- raw_evidence_notes must describe exactly what is visible (short phrases).\n"
        f"- asset_id must be '{asset_id}'.\n"
        f"- source_ref.filename must be '{source_ref.filename}'.\n"
        f"- source_ref.page must be {source_ref.page if source_ref.page is not None else 'null'}.\n"
    )


def _extract_openai(
    *,
    settings: Settings,
    image_path: Path,
    asset_id: str,
    source_type: str,
    source_ref: SourceRef,
) -> AssetExtraction:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required for OpenAI extraction.")

    from openai import OpenAI

    mime = _mime_for_image(image_path)
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    schema = _asset_extraction_schema()
    prompt = _common_prompt(asset_id, source_ref)

    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.responses.create(
        model=settings.openai_model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": data_url},
                ],
            }
        ],
        text={"format": {"type": "json_schema", "name": "asset_extraction", "schema": schema, "strict": True}},
    )

    raw = resp.output_text
    if not raw:
        raise RuntimeError("OpenAI response contained no output_text.")

    obj = json.loads(raw)

    # Enforce provenance fields from our system of record.
    obj["asset_id"] = asset_id
    obj["source_ref"] = {"filename": source_ref.filename, "page": source_ref.page}
    obj["source_type"] = "pdf_page" if source_type == "pdf_page" else "image"

    return AssetExtraction.model_validate(obj)


def _extract_anthropic(
    *,
    settings: Settings,
    image_path: Path,
    asset_id: str,
    source_type: str,
    source_ref: SourceRef,
) -> AssetExtraction:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is required for Anthropic extraction.")

    try:
        from anthropic import Anthropic
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "Anthropic provider requested but 'anthropic' package is not available. "
            "Run: make install"
        ) from e

    mime, img_bytes = _prepare_image_bytes_for_anthropic(image_path)
    b64 = base64.b64encode(img_bytes).decode("ascii")
    if len(b64) > ANTHROPIC_IMAGE_MAX_B64_BYTES:
        raise RuntimeError(
            "Image too large for Anthropic (base64 payload exceeds 5 MiB) even after preprocessing."
        )

    schema = _asset_extraction_schema()
    prompt = _common_prompt(asset_id, source_ref)

    client = Anthropic(api_key=settings.anthropic_api_key)

    def _create(model: str):
        return client.messages.create(
            model=model,
            max_tokens=2000,
            temperature=0,
            tools=[
                {
                    "name": "asset_extraction",
                    "description": "Return strict structured extraction for a single WBR asset.",
                    "input_schema": schema,
                }
            ],
            tool_choice={"type": "tool", "name": "asset_extraction"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                    ],
                }
            ],
        )

    model = settings.anthropic_model
    try:
        msg = _create(model)
    except Exception as e:
        # Common foot-gun: default model string isn't available on the user's Anthropic account.
        try:
            import anthropic

            if isinstance(e, anthropic.NotFoundError):
                resolved = _resolve_anthropic_model(client, requested=model)
                # Persist in-memory so /api/health and subsequent extractions show the real model.
                if resolved and resolved != model:
                    settings.anthropic_model = resolved
                msg = _create(resolved or model)
            else:
                raise
        except Exception:
            raise

    obj: Any = None
    for block in getattr(msg, "content", []) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "asset_extraction":
            obj = getattr(block, "input", None)
            break

    if obj is None:
        # Fallback: try to parse concatenated text blocks as JSON.
        text = ""
        for block in getattr(msg, "content", []) or []:
            if getattr(block, "type", None) == "text":
                text += getattr(block, "text", "")
        if not text.strip():
            raise RuntimeError("Anthropic response contained no tool_use and no text.")
        obj = json.loads(text)

    # Enforce provenance fields from our system of record.
    obj["asset_id"] = asset_id
    obj["source_ref"] = {"filename": source_ref.filename, "page": source_ref.page}
    obj["source_type"] = "pdf_page" if source_type == "pdf_page" else "image"

    return AssetExtraction.model_validate(obj)


_ANTHROPIC_MODELS_LOCK = threading.Lock()
_ANTHROPIC_MODELS_CACHE: dict[str, list[str]] = {}


def _resolve_anthropic_model(client: Any, *, requested: str) -> str:
    """
    Pick a working Anthropic model id.

    Uses the account's available model list and selects a reasonable default when the requested model is not found.
    """
    api_key = getattr(client, "api_key", "") or ""
    cache_key = api_key[-8:] if api_key else "no_key"

    with _ANTHROPIC_MODELS_LOCK:
        ids = _ANTHROPIC_MODELS_CACHE.get(cache_key)
        if ids is None:
            resp = client.models.list(limit=100)
            models = getattr(resp, "data", None) or []
            ids = [getattr(m, "id", None) for m in models]
            ids = [i for i in ids if isinstance(i, str) and i]
            _ANTHROPIC_MODELS_CACHE[cache_key] = ids

    if requested in ids:
        return requested

    # Prefer Sonnet variants (cost/capability balance), then Haiku.
    priority = [
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-20250514",
        "claude-3-7-sonnet-20250219",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-haiku-20240307",
    ]
    for cand in priority:
        if cand in ids:
            return cand

    return ids[0] if ids else requested
