"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/ui/cn";

type Props = {
  origins: string[];
  destinations: string[];
  className?: string;
};

function getParam(params: URLSearchParams, key: string): string {
  return params.get(key) ?? "";
}

function getBool(params: URLSearchParams, key: string): boolean {
  const v = params.get(key);
  return v === "1" || v === "true";
}

export function Filters(props: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const initial = useMemo(() => {
    const p = new URLSearchParams(sp.toString());
    return {
      origin: getParam(p, "origin"),
      destination: getParam(p, "destination"),
      departFrom: getParam(p, "departFrom"),
      departTo: getParam(p, "departTo"),
      returnFrom: getParam(p, "returnFrom"),
      returnTo: getParam(p, "returnTo"),
      nonstopOnly: getBool(p, "nonstopOnly"),
      overnightOnly: getBool(p, "overnightOnly"),
      maxStopsTotal: getParam(p, "maxStopsTotal"),
      sort: getParam(p, "sort") || "dealScore",
    };
  }, [sp]);

  const [state, setState] = useState(initial);

  const apply = () => {
    const next = new URLSearchParams();
    if (state.origin) next.set("origin", state.origin);
    if (state.destination) next.set("destination", state.destination);
    if (state.departFrom) next.set("departFrom", state.departFrom);
    if (state.departTo) next.set("departTo", state.departTo);
    if (state.returnFrom) next.set("returnFrom", state.returnFrom);
    if (state.returnTo) next.set("returnTo", state.returnTo);
    if (state.nonstopOnly) next.set("nonstopOnly", "1");
    if (state.overnightOnly) next.set("overnightOnly", "1");
    if (state.maxStopsTotal) next.set("maxStopsTotal", state.maxStopsTotal);
    if (state.sort) next.set("sort", state.sort);
    router.push(`/?${next.toString()}`);
  };

  const reset = () => router.push("/");

  return (
    <div className={cn("rounded-2xl border border-neutral-200 bg-white p-4", props.className)}>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Origin</span>
          <select
            value={state.origin}
            onChange={(e) => setState((s) => ({ ...s, origin: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          >
            <option value="">Any</option>
            {props.origins.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Destination</span>
          <select
            value={state.destination}
            onChange={(e) => setState((s) => ({ ...s, destination: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          >
            <option value="">Any</option>
            {props.destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Depart From</span>
          <input
            type="date"
            value={state.departFrom}
            onChange={(e) => setState((s) => ({ ...s, departFrom: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Depart To</span>
          <input
            type="date"
            value={state.departTo}
            onChange={(e) => setState((s) => ({ ...s, departTo: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Return From</span>
          <input
            type="date"
            value={state.returnFrom}
            onChange={(e) => setState((s) => ({ ...s, returnFrom: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Return To</span>
          <input
            type="date"
            value={state.returnTo}
            onChange={(e) => setState((s) => ({ ...s, returnTo: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Max Stops</span>
          <input
            type="number"
            min={0}
            max={2}
            value={state.maxStopsTotal}
            onChange={(e) => setState((s) => ({ ...s, maxStopsTotal: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
            placeholder="1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">Sort</span>
          <select
            value={state.sort}
            onChange={(e) => setState((s) => ({ ...s, sort: e.target.value }))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
          >
            <option value="dealScore">Deal Score</option>
            <option value="totalPrice">Total Price</option>
            <option value="duration">Duration</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.nonstopOnly}
            onChange={(e) => setState((s) => ({ ...s, nonstopOnly: e.target.checked }))}
          />
          <span>Nonstop only</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.overnightOnly}
            onChange={(e) => setState((s) => ({ ...s, overnightOnly: e.target.checked }))}
          />
          <span>Overnight-only (1-stop)</span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:bg-neutral-50"
          >
            Reset
          </button>
          <button type="button" onClick={apply} className="rounded-lg bg-black px-3 py-2 text-white hover:bg-neutral-800">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

