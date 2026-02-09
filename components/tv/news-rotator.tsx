"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Newspaper, Rss } from "lucide-react";
import type { EnrichedMention } from "@/lib/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/cn";

function SourceIcon({ source }: { source: string }) {
  const s = source.toLowerCase();
  if (s.includes("reddit")) return <MessageCircle className="h-5 w-5" />;
  if (s.includes("rss")) return <Rss className="h-5 w-5" />;
  return <Newspaper className="h-5 w-5" />;
}

function sentimentVariant(label: EnrichedMention["sentimentLabel"]) {
  if (label === "positive") return "success";
  if (label === "negative") return "danger";
  if (label === "neutral") return "neutral";
  return "outline";
}

function safeDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatInTimeZone(dateIso: string, timeZone: string) {
  const d = new Date(dateIso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function NewsRotator(props: {
  mentions: EnrichedMention[];
  timeZone: string;
  intervalMs?: number;
  className?: string;
}) {
  const intervalMs = props.intervalMs ?? 9000;
  const mentions = props.mentions;
  const [idx, setIdx] = useState(0);

  const visible = useMemo(() => {
    // Prefer non-unknown items for the TV headline loop.
    const ranked = mentions.filter((m) => m.sentimentLabel !== "unknown");
    return ranked.length ? ranked : mentions;
  }, [mentions]);

  useEffect(() => {
    setIdx(0);
  }, [visible.length]);

  useEffect(() => {
    if (visible.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % visible.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, visible.length]);

  if (!visible.length) {
    return (
      <div
        className={cn(
          "rounded-2xl border bg-card/60 p-6 shadow-glow backdrop-blur-sm",
          props.className,
        )}
      >
        <div className="text-sm text-muted-foreground">Headlines</div>
        <div className="mt-3 text-lg text-muted-foreground">
          No mentions available.
        </div>
      </div>
    );
  }

  const current = visible[idx]!;
  const next = [1, 2, 3]
    .map((offset) => visible[(idx + offset) % visible.length]!)
    .filter(Boolean);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card/60 p-6 shadow-glow backdrop-blur-sm",
        props.className,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <SourceIcon source={current.source} />
            <span className="capitalize">{current.source}</span>
          </span>
          <span className="text-muted-foreground/60">|</span>
          <span>{formatInTimeZone(current.publishedAt, props.timeZone)}</span>
          <span className="text-muted-foreground/60">|</span>
          <span className="max-w-[28ch] truncate">{safeDomain(current.url)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={sentimentVariant(current.sentimentLabel)}
            className="px-3 py-1 text-sm"
          >
            {current.sentimentLabel}
          </Badge>
          <div className="text-xs text-muted-foreground">
            {idx + 1}/{visible.length}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div key={current.id} className="animate-fade-up">
            <div className="font-display text-[26px] leading-tight tracking-tight line-clamp-5">
              {current.text}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {current.topics.slice(0, 3).map((t) => (
              <Badge key={t} variant="brand" className="px-3 py-1 text-sm">
                {t}
              </Badge>
            ))}
            {current.keyPhrases.slice(0, 2).map((p) => (
              <Badge
                key={p}
                variant="outline"
                className="px-3 py-1 text-sm text-muted-foreground"
              >
                {p}
              </Badge>
            ))}
          </div>
        </div>

        <div className="rounded-xl border bg-background/40 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Up Next
          </div>
          <ul className="mt-3 space-y-3">
            {next.map((m) => (
              <li key={m.id} className="text-sm leading-snug text-muted-foreground">
                <span className="line-clamp-2">{m.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

