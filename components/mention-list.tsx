import Link from "next/link";
import { ExternalLink, MessageCircle, Newspaper, Rss } from "lucide-react";
import type { EnrichedMention } from "@/lib/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/cn";

function SourceIcon({ source }: { source: string }) {
  const s = source.toLowerCase();
  if (s.includes("reddit")) return <MessageCircle className="h-4 w-4" />;
  if (s.includes("rss")) return <Rss className="h-4 w-4" />;
  return <Newspaper className="h-4 w-4" />;
}

function sentimentVariant(label: EnrichedMention["sentimentLabel"]) {
  if (label === "positive") return "success";
  if (label === "negative") return "danger";
  if (label === "neutral") return "neutral";
  return "outline";
}

export function MentionList({ mentions }: { mentions: EnrichedMention[] }) {
  return (
    <div className="space-y-2">
      {mentions.map((m) => (
        <div
          key={m.id}
          className={cn(
            "group rounded-lg border bg-card/70 p-3 shadow-sm backdrop-blur-sm transition-colors hover:bg-card",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <SourceIcon source={m.source} />
                  <span className="capitalize">{m.source}</span>
                </span>
                <span className="text-muted-foreground/60">|</span>
                <span>{new Date(m.publishedAt).toLocaleString()}</span>
                {m.author ? (
                  <>
                    <span className="text-muted-foreground/60">|</span>
                    <span>{m.author}</span>
                  </>
                ) : null}
              </div>
              <p className="mt-2 line-clamp-3 text-sm leading-snug">
                {m.text}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant={sentimentVariant(m.sentimentLabel)}>
                  {m.sentimentLabel}
                </Badge>
                {m.topics.map((t) => (
                  <Badge key={t} variant="brand">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            <Link
              href={m.url}
              target="_blank"
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Open source"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
