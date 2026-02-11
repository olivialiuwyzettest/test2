import React, { useEffect, useMemo, useRef, useState } from "react";

type Run = {
  id: string;
  week: string;
  status: string;
  stage: string;
  progress_current: number;
  progress_total: number;
  message?: string | null;
  created_at?: string;
};

type Asset = {
  id: string;
  source_type: string;
  original_filename: string;
  page?: number | null;
  status: string;
  error?: string | null;
};

type Health = {
  ok: boolean;
  mock_mode: boolean;
  provider?: string;
  model: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export default function App() {
  const [week, setWeek] = useState("2026-W06");
  const [maxTopics, setMaxTopics] = useState(6);
  const [maxInsights, setMaxInsights] = useState(12);
  const [agendaNotes, setAgendaNotes] = useState("");

  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const [health, setHealth] = useState<Health | null>(null);

  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const progressLabel = useMemo(() => {
    if (!run) return "";
    const cur = run.progress_current ?? 0;
    const tot = run.progress_total ?? 0;
    const pct = tot > 0 ? Math.round((cur / tot) * 100) : 0;
    return `${run.stage} • ${cur}/${tot} • ${pct}%`;
  }, [run]);

  useEffect(() => {
    let alive = true;
    api<Health>("/api/health")
      .then((h) => {
        if (!alive) return;
        setHealth(h);
      })
      .catch(() => {
        // ignore; UI can still function partially
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const tick = async () => {
      try {
        const data = await api<{ run: Run; assets: Asset[] }>(`/api/runs/${runId}`);
        if (!alive) return;
        setRun(data.run);
        setAssets(data.assets);
        if (data.run.status === "succeeded") {
          try {
            const doc = await fetch(`/api/runs/${runId}/out/insights.json`).then((r) => r.json());
            setWarnings(Array.isArray(doc?.warnings) ? doc.warnings : []);
          } catch {
            // ignore
          }
        }
      } catch (e: any) {
        if (!alive) return;
        setError(String(e?.message || e));
      }
    };
    tick();
    const t = window.setInterval(tick, 1200);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [runId]);

  const onFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).filter((f) => {
      const n = f.name.toLowerCase();
      return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".pdf");
    });
    setFiles((prev) => [...prev, ...arr]);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      if (files.length === 0) throw new Error("Add at least one .png/.jpg/.jpeg/.pdf file.");

      const created = await api<Run>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          week,
          max_topics: maxTopics,
          max_insights: maxInsights,
          agenda_notes: agendaNotes || null
        })
      });

      setRunId(created.id);

      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      await fetch(`/api/runs/${created.id}/uploads`, { method: "POST", body: fd }).then((r) => {
        if (!r.ok) throw new Error(`Upload failed: ${r.status} ${r.statusText}`);
      });

      await api(`/api/runs/${created.id}/start`, { method: "POST" });
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const openDeck = () => {
    if (!runId) return;
    window.open(`/api/runs/${runId}/out/deck.html`, "_blank");
  };

  const downloadZip = () => {
    if (!runId) return;
    window.open(`/api/runs/${runId}/download.zip`, "_blank");
  };

  return (
    <div className="page">
      <div className="topbar">
        <h1>wbr-deck-agent</h1>
        {health ? (
          <span className={`pill ${health.mock_mode ? "pill-accent" : "pill-ok"}`}>
            {health.mock_mode ? "Mock mode" : "Live extraction"}
            {health.provider ? ` • ${health.provider}` : ""} • {health.model}
          </span>
        ) : null}
      </div>
      <div className="sub">
        Local-first WBR deck generator. Strict grounding: any unsupported claim is labeled as{" "}
        <span className="pill">[NEEDS DATA]</span> or <span className="pill">[HYPOTHESIS]</span>.
      </div>
      {health?.mock_mode ? (
        <div className="warn" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 650, marginBottom: 6 }}>Mock mode is enabled</div>
          <div style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>
            Set OPENAI_API_KEY for real vision extraction, then restart the backend.
          </div>
        </div>
      ) : null}
      <div className="rule" />

      <div className="grid">
        <div className="card">
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label>WBR week/date</label>
              <input value={week} onChange={(e) => setWeek(e.target.value)} type="text" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>Max topics</label>
                <input
                  value={maxTopics}
                  onChange={(e) => setMaxTopics(Number(e.target.value))}
                  type="number"
                  min={1}
                  max={12}
                />
              </div>
              <div>
                <label>Max insights</label>
                <input
                  value={maxInsights}
                  onChange={(e) => setMaxInsights(Number(e.target.value))}
                  type="number"
                  min={1}
                  max={40}
                />
              </div>
            </div>
            <div>
              <label>Agenda notes (optional)</label>
              <textarea value={agendaNotes} onChange={(e) => setAgendaNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          <div
            className={`drop ${drag ? "drag" : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDrag(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onFiles(e.dataTransfer.files);
            }}
          >
            <p className="drop-title">Upload assets</p>
            <p className="drop-sub">Drag and drop 50+ screenshots/PDFs here, or choose files.</p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.pdf"
              onChange={(e) => onFiles(e.target.files)}
            />

            <div className="btn-row">
              <button
                className="primary"
                disabled={busy || files.length === 0}
                onClick={() => start()}
              >
                Create run + start
              </button>
              <button
                disabled={busy || files.length === 0}
                onClick={() => setFiles([])}
                title="Clears selected files (does not delete uploads on disk)."
              >
                Clear files
              </button>
            </div>

            <div className="status">
              Selected: <span className="pill">{files.length}</span>
            </div>
          </div>

          {runId && run && (
            <div style={{ marginTop: 14 }}>
              <div className="status">
                Run: <span className="pill">{runId}</span>
              </div>
              <div className="status">
                Status: <span className="pill">{run.status}</span> <span className="pill">{progressLabel}</span>
              </div>
              {run.message && <div className="status">Message: {run.message}</div>}

              <div className="btn-row links">
                <button disabled={run.status !== "succeeded"} onClick={openDeck}>
                  Open deck
                </button>
                <button disabled={run.status !== "succeeded"} onClick={downloadZip}>
                  Download out.zip
                </button>
              </div>

              {warnings.length > 0 && (
                <div className="warn">
                  <div style={{ fontWeight: 650, marginBottom: 6 }}>Warnings</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {warnings.slice(0, 10).map((w, i) => (
                      <li key={i} style={{ margin: "6px 0" }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="warn" style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 650, marginBottom: 6 }}>Error</div>
              <div style={{ color: "var(--muted)", whiteSpace: "pre-wrap" }}>{error}</div>
            </div>
          )}
        </div>
      </div>

      {assets.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 650 }}>Assets</div>
            <div className="status">
              {assets.filter((a) => a.status === "extracted").length}/{assets.length} extracted
            </div>
          </div>
          <div className="soft-rule" />
          <div style={{ display: "grid", gap: 8 }}>
            {assets.slice(0, 60).map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span className="pill">{a.source_type}</span>
                <span className="pill">{a.status}</span>
                <span style={{ color: "var(--text)" }}>
                  {a.original_filename}
                  {a.page ? ` (p${a.page})` : ""}
                </span>
                {a.error ? <span style={{ color: "var(--muted)" }}>• {a.error}</span> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
