import Link from "next/link";
import { allBrands, brandConfig } from "@/config/brands";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const metadata = {
  title: "Methodology | Wyze Pulse",
};

export default function MethodologyPage() {
  const brands = allBrands(brandConfig);

  return (
    <main className="container pb-14 pt-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Methodology
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            How Wyze Pulse turns mentions into the numbers on the dashboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Dashboard</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/tv">TV Mode</Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Data Window</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Each refresh looks at the <b>last 24 hours</b> of mentions ending at
              refresh time, using the configured timezone (default:{" "}
              <code className="rounded bg-secondary px-1.5 py-0.5">
                America/Los_Angeles
              </code>
              ).
            </p>
            <p>
              Mentions come from enabled connectors (sample, RSS, Reddit). Mentions
              are <b>deduplicated by id</b>. If duplicate ids exist, the mention with
              the latest <code className="rounded bg-secondary px-1.5 py-0.5">publishedAt</code>{" "}
              wins.
            </p>
            <div className="rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Tracked brands</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {brands.map((b) => (
                  <Badge key={b} variant={b === brandConfig.primary ? "brand" : "outline"}>
                    {b}
                  </Badge>
                ))}
              </div>
              <div className="mt-2">
                Mentions assigned to brands outside this list are excluded from the
                KPIs (but can still appear in the drill-down list).
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Brand Matching</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Connectors may supply <code className="rounded bg-secondary px-1.5 py-0.5">matchedBrand</code>.
              If missing or unknown, the refresh script performs keyword matching
              against the brand list above.
            </p>
            <p className="text-muted-foreground">
              Coverage note (important): if you only ingest one brand’s forum (e.g.
              only Wyze), competitor comparisons will be biased. When enabling
              Reddit/RSS, include competitor communities and feeds too.
            </p>
            <p className="text-muted-foreground">
              Note: This is an MVP matching approach. For production use, upgrade
              brand/entity detection (e.g., context-aware LLM classification with
              citations) to reduce false matches.
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Sentiment (Score + Index)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Each mention is enriched with:
            </p>
            <ul className="list-disc pl-5 text-sm">
              <li>
                <b>sentimentScore</b>: a float in <code className="rounded bg-secondary px-1.5 py-0.5">[-1, 1]</code>
              </li>
              <li>
                <b>sentimentLabel</b>: positive | neutral | negative | unknown
              </li>
              <li>
                <b>topics</b>: up to 3 short topic labels
              </li>
              <li>
                <b>keyPhrases</b>: up to 5 short phrases
              </li>
            </ul>
            <Separator />
            <p>
              The dashboard shows a 0–100 sentiment index derived from the average
              score:
            </p>
            <pre className="overflow-auto rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
{`avgScore = mean(sentimentScore across mentions in window)
sentimentIndex = clamp(round((avgScore + 1) * 50), 0, 100)`}
            </pre>
            <p className="text-muted-foreground">
              Delta vs yesterday is simply{" "}
              <code className="rounded bg-secondary px-1.5 py-0.5">
                todayIndex - yesterdayIndex
              </code>.
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Distribution, Share Of Voice, Competitors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <b>Sentiment mix</b> counts how many mentions are labeled positive /
              neutral / negative / unknown.
            </p>
            <p>
              <b>Share of voice</b> is based on mention counts:
            </p>
            <pre className="overflow-auto rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
{`share(brand) = mentions(brand) / totalMentions(all tracked brands)`}
            </pre>
            <p className="text-muted-foreground">
              The competitor table shows, per brand: share, mentions, delta mentions
              vs yesterday, and average sentiment score.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Topics + “What Changed”</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Topics are extracted per mention and aggregated by simple counts. The
              dashboard shows top topics and their change vs yesterday:
            </p>
            <pre className="overflow-auto rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
{`topicCount(topic) = number of mentions where topic appears
deltaVsYesterday = todayCount - yesterdayCount`}
            </pre>
            <p className="text-muted-foreground">
              The “What changed since yesterday?” bullets are computed from sentiment
              index delta, mention volume delta, and the biggest topic movement.
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Drivers + Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Drivers are topic clusters among strongly-scored mentions:
            </p>
            <pre className="overflow-auto rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
{`negative drivers: sentimentScore <= -0.25
positive drivers: sentimentScore >=  0.25
group by topic; explanation uses most frequent keyPhrase for that topic`}
            </pre>
            <Separator />
            <p>
              Alerts are simple rules to quickly flag spikes:
            </p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              <li>
                Negative spike if sentiment index drops by 10+ points vs yesterday.
              </li>
              <li>
                Negative spike if negative share jumps by 0.15+ and negatives are 35%+ of volume.
              </li>
              <li>
                Mention spike if volume is 1.6x+ vs yesterday (with enough baseline), or unusually high on a low baseline.
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Notes + Limitations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              This dashboard is designed to be fast and high-signal. It intentionally
              uses lightweight aggregation (counts and averages).
            </p>
            <p>
              Sentiment and topics are model outputs and can be wrong. Treat them as
              directional; validate with the underlying mentions when making decisions.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
