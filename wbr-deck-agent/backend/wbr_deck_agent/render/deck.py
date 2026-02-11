from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from jinja2 import Template


_TEMPLATE = Template(
    """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WBR — {{ week }}</title>
    <style>
      :root {
        --accent: #7951D6;
        --text: #0b0b0f;
        --muted: #5a5a66;
        --border: #e8e8ef;
      }
      html, body { background: #fff; color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
      body { margin: 0; }
      a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--border); }
      a:hover { border-bottom-color: var(--accent); }
      .page { max-width: 1100px; margin: 0 auto; padding: 56px 28px 96px; }
      .title { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
      h1 { font-size: 46px; line-height: 1.05; margin: 0; letter-spacing: -0.02em; }
      .meta { color: var(--muted); font-size: 14px; }
      .rule { height: 3px; background: var(--accent); margin: 18px 0 28px; opacity: 0.95; }
      .soft-rule { height: 1px; background: var(--border); margin: 22px 0; }
      .section-title { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin: 42px 0 14px; }
      .toc { display: flex; flex-wrap: wrap; gap: 10px 14px; margin-top: 6px; }
      .toc a { padding: 6px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 13px; color: var(--muted); }
      .toc a:hover { border-color: var(--accent); color: var(--text); }
      .exec-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
      .exec-item { padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; }
      .exec-head { font-weight: 650; font-size: 16px; line-height: 1.25; }
      .exec-src { color: var(--muted); font-size: 12px; margin-top: 6px; }
      .topic-break { margin: 56px 0 18px; }
      .topic-break .bar { height: 5px; background: var(--accent); }
      .topic-break h2 { margin: 14px 0 0; font-size: 30px; letter-spacing: -0.01em; }
      .blocks { display: grid; grid-template-columns: 1fr; gap: 14px; margin-top: 16px; }
      .block { padding: 18px 18px 14px; border: 1px solid var(--border); border-radius: 16px; }
      .block h3 { margin: 0; font-size: 18px; line-height: 1.25; }
      .bullets { margin: 10px 0 0; padding-left: 18px; color: var(--text); }
      .bullets li { margin: 8px 0; }
      .label { color: var(--muted); font-weight: 650; }
      .evidence { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
      .thumb { width: 210px; max-width: 46vw; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: #fff; }
      .thumb img { display: block; width: 100%; height: auto; }
      .thumb .cap { font-size: 11px; color: var(--muted); padding: 8px 10px; border-top: 1px solid var(--border); }
      details { margin-top: 10px; }
      summary { cursor: pointer; color: var(--muted); }
      pre { white-space: pre-wrap; word-break: break-word; background: #fafafe; border: 1px solid var(--border); border-radius: 12px; padding: 14px; font-size: 12px; line-height: 1.35; }
      .warnings { border-left: 4px solid var(--accent); padding: 10px 14px; background: #fbf9ff; }
      @media (min-width: 980px) {
        .blocks { grid-template-columns: 1fr 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="title">
        <h1>WBR — {{ week }}</h1>
        <div class="meta">
          Generated: {{ generated_at }} UTC
          • Inputs: {{ input_summary.assets_total }} assets ({{ input_summary.images }} images, {{ input_summary.pdf_pages }} pdf pages)
          • Topics found: {{ input_summary.topics_found | join(", ") if input_summary.topics_found else "none" }}
        </div>
      </div>
      <div class="rule"></div>

      <div class="section-title">Exec Summary (Top 5)</div>
      <div class="exec-grid">
        {% for ins in exec_summary %}
          <div class="exec-item">
            <div class="exec-head">{{ ins.headline }}</div>
            <div class="exec-src">Sources: {{ ins._citations }}</div>
          </div>
        {% endfor %}
      </div>

      <div class="section-title">Topics</div>
      <div class="toc">
        {% for t in topics %}
          <a href="#topic-{{ t.id }}">{{ t.name }}</a>
        {% endfor %}
      </div>

      {% for t in topics %}
        <div class="topic-break" id="topic-{{ t.id }}">
          <div class="bar"></div>
          <h2>{{ t.name }}</h2>
        </div>

        <div class="blocks">
          {% for ins in by_topic[t.name] %}
            <div class="block">
              <h3>{{ ins.headline }}</h3>
              <ul class="bullets">
                {% if ins.what_changed %}
                  <li><span class="label">What changed:</span> {{ ins.what_changed[0] }}</li>
                {% endif %}
                {% if ins.why_it_matters %}
                  <li><span class="label">Why it matters:</span> {{ ins.why_it_matters[0] }}</li>
                {% endif %}
                {% if ins.discussion_questions %}
                  <li><span class="label">Questions:</span> {{ ins.discussion_questions[0] }}</li>
                {% endif %}
              </ul>
              <div class="evidence">
                {% for ev in ins.evidence[:2] %}
                  <div class="thumb">
                    {% if ev.thumbnail_crop %}
                      <img src="{{ ev.thumbnail_crop }}" alt="evidence thumbnail" />
                    {% else %}
                      <div style="padding: 12px; color: var(--muted); font-size: 12px;">(no thumbnail)</div>
                    {% endif %}
                    <div class="cap">{{ ev.filename }}{% if ev.page %} (p{{ ev.page }}){% endif %}</div>
                  </div>
                {% endfor %}
              </div>
            </div>
          {% endfor %}
        </div>
      {% endfor %}

      <div class="section-title">Appendix</div>

      <div class="warnings">
        <div style="font-weight: 650;">Model warnings</div>
        {% if warnings %}
          <ul class="bullets">
            {% for w in warnings %}
              <li>{{ w }}</li>
            {% endfor %}
          </ul>
        {% else %}
          <div class="meta">No warnings.</div>
        {% endif %}
      </div>

      <details>
        <summary>All extracted metrics (structured)</summary>
        <pre>{{ all_metrics_json }}</pre>
      </details>

      <details>
        <summary>Assets list</summary>
        <pre>{{ assets_json }}</pre>
      </details>

      <details>
        <summary>Relationships (heuristic)</summary>
        <pre>{{ relationships_json }}</pre>
      </details>
    </div>
  </body>
</html>
"""
)


def _citations(ins: dict[str, Any]) -> str:
    evs = ins.get("evidence") or []
    parts: list[str] = []
    for ev in evs[:3]:
        fn = ev.get("filename", "")
        p = ev.get("page")
        if p:
            parts.append(f"{fn} p{p}")
        else:
            parts.append(fn)
    return ", ".join([p for p in parts if p]) or "[NEEDS DATA]"


def render_deck_html(doc: dict[str, Any]) -> str:
    insights = list(doc.get("insights") or [])
    # Exec summary: top 5 by importance score.
    top = sorted(insights, key=lambda x: int(x.get("importance_score") or 0), reverse=True)[:5]
    for ins in top:
        ins["_citations"] = _citations(ins)

    topics_raw = list(doc.get("topics") or [])
    topics = [{"name": t, "id": _slug(t)} for t in topics_raw]
    by_topic: dict[str, list[dict[str, Any]]] = {t: [] for t in topics_raw}
    for ins in insights:
        t = ins.get("topic") or (topics_raw[0] if topics_raw else "misc")
        if t not in by_topic:
            continue
        by_topic[t].append(ins)

    # Keep each topic to 2-5 blocks for readability.
    for t in list(by_topic.keys()):
        by_topic[t] = sorted(by_topic[t], key=lambda x: int(x.get("importance_score") or 0), reverse=True)[:5]
        if len(by_topic[t]) < 2:
            by_topic[t] = by_topic[t][:2]

    return _TEMPLATE.render(
        week=html.escape(str(doc.get("week") or "")),
        generated_at=html.escape(str(doc.get("generated_at") or "")),
        input_summary=doc.get("input_summary") or {},
        topics=topics,
        by_topic=by_topic,
        exec_summary=top,
        warnings=doc.get("warnings") or [],
        all_metrics_json=json.dumps(doc.get("all_metrics") or {}, indent=2, ensure_ascii=True),
        assets_json=json.dumps(doc.get("assets") or [], indent=2, ensure_ascii=True),
        relationships_json=json.dumps(doc.get("relationships") or [], indent=2, ensure_ascii=True),
    )


def _slug(s: str) -> str:
    out = []
    for ch in s.strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "_", "-"):
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "topic"


def write_deck(out_path: Path, doc: dict[str, Any]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_deck_html(doc), encoding="utf-8")
