import { TVDashboard } from "@/components/tv/tv-dashboard";
import { loadHistory30d, loadLatest, loadMentionsLatest } from "@/lib/data/load";

export const metadata = {
  title: "TV Mode | Wyze Pulse",
  description: "Full-screen TV dashboard view for Wyze Pulse.",
};

export default async function TvPage() {
  try {
    const [latest, history, mentions] = await Promise.all([
      loadLatest(),
      loadHistory30d(),
      loadMentionsLatest(),
    ]);

    return (
      <TVDashboard
        initialLatest={latest}
        initialHistory={history}
        initialMentions={mentions.slice(0, 120)}
      />
    );
  } catch (err) {
    return (
      <main className="container py-10">
        <h1 className="font-display text-2xl font-semibold">Wyze Pulse TV</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Dashboard data is missing or invalid. Run{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5">
            pnpm refresh-data:sample
          </code>{" "}
          to generate sample data.
        </p>
        <pre className="mt-4 overflow-auto rounded-lg border bg-card p-4 text-xs text-muted-foreground">
          {String(err)}
        </pre>
      </main>
    );
  }
}

