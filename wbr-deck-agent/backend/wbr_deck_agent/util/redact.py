from __future__ import annotations

import re


_PATTERNS: list[re.Pattern[str]] = [
    # GitHub personal access tokens
    re.compile(r"\\bghp_[A-Za-z0-9]{10,}\\b"),
    re.compile(r"\\bgithub_pat_[A-Za-z0-9_]{10,}\\b"),
    # OpenAI-style keys (best-effort; avoid being overly broad)
    re.compile(r"\\bsk-[A-Za-z0-9_-]{10,}\\b"),
    # Anthropic-style keys
    re.compile(r"\\bsk-ant-[A-Za-z0-9_-]{10,}\\b"),
]


def redact_secrets(text: str) -> str:
    out = text
    for pat in _PATTERNS:
        out = pat.sub("[REDACTED]", out)
    return out

