"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/ui/cn";

export function RunScanNowButton(props: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setLastStatus(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
      setLastStatus(json?.status ?? "OK");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className={cn(
          "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium",
          "bg-black text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {loading ? "Scanning..." : "Run Scan Now"}
      </button>
      {lastStatus ? <p className="text-xs text-neutral-600">Last run: {lastStatus}</p> : null}
      {error ? <p className="text-xs text-red-700">Error: {error}</p> : null}
    </div>
  );
}

