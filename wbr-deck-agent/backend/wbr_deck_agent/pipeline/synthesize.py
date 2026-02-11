from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable, Optional, Tuple

from wbr_deck_agent.pipeline.schemas import AssetExtraction, Evidence, Insight


_NUM_RE = re.compile(r"[-+]?\\d+(?:\\.\\d+)?")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def canonical_metric_name(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\\s+", " ", s).strip()
    return s or "unknown_metric"


def _parse_pct(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    if "%" not in s:
        return None
    m = _NUM_RE.search(s.replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except Exception:
        return None


def _topic_for_extraction(ex: AssetExtraction) -> str:
    if ex.tags:
        return ex.tags[0]
    return "misc"


def build_relationships(extractions: list[AssetExtraction], *, max_edges: int = 20) -> list[dict[str, Any]]:
    # Co-mention graph: metrics co-occurring in the same asset.
    pair_count: Counter[tuple[str, str]] = Counter()
    pair_evidence: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)

    for ex in extractions:
        names = [canonical_metric_name(m.name) for m in ex.metrics if m.name.strip()]
        uniq = sorted(set(names))
        for i in range(len(uniq)):
            for j in range(i + 1, len(uniq)):
                a, b = uniq[i], uniq[j]
                pair_count[(a, b)] += 1
                pair_evidence[(a, b)].append(
                    {"asset_id": ex.asset_id, "filename": ex.source_ref.filename, "page": ex.source_ref.page}
                )

    edges: list[dict[str, Any]] = []
    for (a, b), cnt in pair_count.most_common(max_edges):
        support_level = "supported" if cnt >= 2 else "likely"
        edges.append(
            {
                "from_metric": a,
                "to_metric": b,
                "support_level": support_level,
                "count": cnt,
                "evidence": pair_evidence[(a, b)][:5],
            }
        )
    return edges


def _agenda_bonus(topic: str, agenda_notes: Optional[str]) -> int:
    if not agenda_notes:
        return 0
    a = agenda_notes.lower()
    if topic.lower() in a:
        return 10
    return 0


def generate_insights(
    extractions: list[AssetExtraction],
    *,
    max_topics: int,
    max_insights: int,
    agenda_notes: Optional[str],
    asset_thumbs: dict[str, str],
) -> Tuple[list[str], list[Insight], dict[str, Any]]:
    # Topics from tag frequency, with a safe fallback.
    tag_counts = Counter(tag for ex in extractions for tag in ex.tags)
    topics = [t for (t, _c) in tag_counts.most_common(max_topics)]
    if not topics:
        topics = ["misc"]

    # Metric index with provenance.
    metric_instances: dict[str, list[dict[str, Any]]] = defaultdict(list)
    metric_display: dict[str, str] = {}

    for ex in extractions:
        for m in ex.metrics:
            canon = canonical_metric_name(m.name)
            metric_display.setdefault(canon, m.name.strip() or canon)
            metric_instances[canon].append(
                {
                    "asset_id": ex.asset_id,
                    "filename": ex.source_ref.filename,
                    "page": ex.source_ref.page,
                    "value": m.value,
                    "unit": m.unit,
                    "directionality": m.directionality,
                    "comparisons": [c.model_dump() for c in m.comparisons],
                }
            )

    metric_freq = {k: len(v) for k, v in metric_instances.items()}

    # Candidate insights: metric deltas first; then notable_trends if needed.
    candidates: list[Insight] = []

    for ex in extractions:
        topic = _topic_for_extraction(ex)
        if topic not in topics:
            # Keep some coverage even when topic pruning happens.
            topic = topics[0]

        ev = Evidence(
            asset_id=ex.asset_id,
            filename=ex.source_ref.filename,
            page=ex.source_ref.page,
            thumbnail_crop=asset_thumbs.get(ex.asset_id),
            note=None,
        )

        if ex.metrics:
            for m in ex.metrics[:6]:
                canon = canonical_metric_name(m.name)
                best_cmp = None
                for c in m.comparisons:
                    if c.delta_pct or c.delta_abs:
                        best_cmp = c
                        break
                delta_snip = ""
                if best_cmp:
                    delta_snip = (best_cmp.delta_pct or best_cmp.delta_abs or "").strip()
                    if delta_snip:
                        delta_snip = f"{best_cmp.type} {delta_snip}"

                headline = m.name.strip() or canon
                if delta_snip:
                    headline = f"{headline} ({delta_snip})"

                what_changed = []
                base_val = f"{m.value}{m.unit}".strip() if (m.value or m.unit) else ""
                if base_val and delta_snip:
                    what_changed.append(f"{m.name}: {base_val}; {delta_snip}.")
                elif base_val:
                    what_changed.append(f"{m.name}: {base_val}.")
                elif delta_snip:
                    what_changed.append(f"{m.name}: {delta_snip}.")
                else:
                    what_changed.append(f"{m.name}: [NEEDS DATA] value/delta not extracted.")

                why_it_matters = [
                    "Why it matters: keep focus on the few KPIs that moved and align on drivers.",
                ]
                discussion_questions = [
                    "Question: what are the top 1-2 drivers behind this move?",
                ]

                # Importance score heuristic (grounded in extracted delta strings).
                score = 10
                pct = _parse_pct(best_cmp.delta_pct if best_cmp else None) if best_cmp else None
                if pct is not None:
                    score += 30 if abs(pct) >= 10 else 20 if abs(pct) >= 5 else 10
                if best_cmp and best_cmp.delta_abs:
                    score += 10
                score += min(20, 5 * max(0, metric_freq.get(canon, 1) - 1))
                score += _agenda_bonus(topic, agenda_notes)
                if ex.confidence >= 0.75:
                    score += 10
                elif ex.confidence <= 0.35:
                    score -= 10
                score = max(0, min(100, score))

                candidates.append(
                    Insight(
                        id=uuid.uuid4().hex,
                        topic=topic,
                        headline=headline,
                        what_changed=what_changed[:2],
                        why_it_matters=why_it_matters[:2],
                        discussion_questions=discussion_questions[:2],
                        metrics_mentioned=[m.name],
                        evidence=[ev],
                        labels=["supported"] if base_val or delta_snip else ["needs_data"],
                        importance_score=score,
                    )
                )
        else:
            # No metrics extracted: fallback to notable_trends with explicit labeling.
            trend = ex.notable_trends[0] if ex.notable_trends else "[NEEDS DATA] No trend extracted."
            candidates.append(
                Insight(
                    id=uuid.uuid4().hex,
                    topic=topic,
                    headline=f"{trend}",
                    what_changed=[trend],
                    why_it_matters=["Why it matters: [NEEDS DATA] missing structured metrics in extraction."],
                    discussion_questions=["Question: which metric(s) on this dashboard should anchor the discussion?"],
                    metrics_mentioned=[],
                    evidence=[ev],
                    labels=["needs_data"],
                    importance_score=5 + _agenda_bonus(topic, agenda_notes),
                )
            )

    # Deduplicate near-identical headlines within a topic.
    seen: set[tuple[str, str]] = set()
    deduped: list[Insight] = []
    for ins in sorted(candidates, key=lambda i: i.importance_score, reverse=True):
        key = (ins.topic.lower(), canonical_metric_name(ins.headline))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(ins)

    # Select top insights with per-topic caps.
    per_topic_cap = 5
    per_topic_counts: Counter[str] = Counter()
    selected: list[Insight] = []
    for ins in deduped:
        if len(selected) >= max_insights:
            break
        if per_topic_counts[ins.topic] >= per_topic_cap:
            continue
        selected.append(ins)
        per_topic_counts[ins.topic] += 1

    # Recompute final topics based on selected insights order.
    final_topics: list[str] = []
    for ins in selected:
        if ins.topic not in final_topics:
            final_topics.append(ins.topic)
        if len(final_topics) >= max_topics:
            break

    all_metrics = {
        canon: {"display_name": metric_display.get(canon, canon), "instances": metric_instances[canon]}
        for canon in sorted(metric_instances.keys())
    }

    return final_topics, selected, all_metrics


def build_input_summary(extractions: Iterable[AssetExtraction]) -> dict[str, Any]:
    total = 0
    images = 0
    pdf_pages = 0
    tags = Counter()
    for ex in extractions:
        total += 1
        if ex.source_type == "pdf_page":
            pdf_pages += 1
        else:
            images += 1
        tags.update(ex.tags)
    return {
        "assets_total": total,
        "images": images,
        "pdf_pages": pdf_pages,
        "topics_found": [t for (t, _c) in tags.most_common(12)],
    }


def build_insights_document(
    *,
    run_id: str,
    week: str,
    extractions: list[AssetExtraction],
    assets: list[dict[str, Any]],
    max_topics: int,
    max_insights: int,
    agenda_notes: Optional[str],
    asset_thumbs: dict[str, str],
    warnings: list[str],
) -> dict[str, Any]:
    input_summary = build_input_summary(extractions)
    relationships = build_relationships(extractions)
    topics, insights, all_metrics = generate_insights(
        extractions,
        max_topics=max_topics,
        max_insights=max_insights,
        agenda_notes=agenda_notes,
        asset_thumbs=asset_thumbs,
    )
    return {
        "run_id": run_id,
        "week": week,
        "generated_at": _utc_now_iso(),
        "input_summary": input_summary,
        "topics": topics,
        "insights": [i.model_dump() for i in insights],
        "all_metrics": all_metrics,
        "assets": assets,
        "relationships": relationships,
        "warnings": warnings,
    }
