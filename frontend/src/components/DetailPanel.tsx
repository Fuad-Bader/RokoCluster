import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { api } from '../lib/api';
import { detailParamsFor, podTargetFor } from '../lib/resource';
import { KIND_STYLE, STATUS_RING } from '../lib/palette';
import type { GraphNode, ResourceDetail } from '../types';

// Best-effort, dependency-free YAML-ish rendering of a manifest. We keep JSON
// for fidelity but format it so it reads like a manifest.
function StatusDot({ node }: { node: GraphNode }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: STATUS_RING[node.status] }}
      title={node.status}
    />
  );
}

export function DetailPanel() {
  const selectedId = useStore((s) => s.selectedId);
  const graph = useStore((s) => s.graph);
  const openTerminal = useStore((s) => s.openTerminal);

  const node = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!node) return;
    let cancelled = false;
    api
      .getDetail(detailParamsFor(node))
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [node?.id]);

  if (!node) {
    return (
      <aside className="w-[380px] shrink-0 border-l border-white/10 bg-panel p-4 text-sm text-gray-400">
        <p className="mt-8 text-center">Select a node to inspect it.</p>
      </aside>
    );
  }

  const pod = podTargetFor(node);
  const labels = Object.entries(node.labels);

  async function runAction(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setError(`✓ ${ok}`);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/10 bg-panel">
      <header className="border-b border-white/10 p-4">
        <div className="flex items-center gap-2">
          <span
            className="grid h-7 w-7 place-items-center rounded text-sm"
            style={{ backgroundColor: KIND_STYLE[node.kind].color + '33', color: KIND_STYLE[node.kind].color }}
          >
            {KIND_STYLE[node.kind].icon}
          </span>
          <div className="min-w-0">
            <div className="truncate font-semibold text-gray-100">{node.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <StatusDot node={node} /> {node.kind}
              {node.namespace ? ` · ${node.namespace}` : ''}
            </div>
          </div>
        </div>
        {node.summary && <p className="mt-2 text-xs text-gray-400">{node.summary}</p>}
      </header>

      {/* Context-sensitive actions */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
        {node.kind === 'Deployment' && node.namespace && (
          <>
            <button
              className="action-btn"
              disabled={busy}
              onClick={() => {
                const v = prompt(`Scale ${node.name} to how many replicas?`);
                if (v != null) void runAction(() => api.scale(node.namespace!, node.name, Number(v)), 'scaled');
              }}
            >
              Scale
            </button>
            <button
              className="action-btn"
              disabled={busy}
              onClick={() => void runAction(() => api.restart(node.namespace!, node.name), 'restart triggered')}
            >
              Restart
            </button>
            <button
              className="action-btn danger"
              disabled={busy}
              onClick={() =>
                confirm(`Delete deployment ${node.name}?`) &&
                void runAction(() => api.remove('Deployment', node.namespace!, node.name), 'deleted')
              }
            >
              Delete
            </button>
          </>
        )}
        {node.kind === 'Pod' && node.namespace && (
          <button
            className="action-btn danger"
            disabled={busy}
            onClick={() =>
              confirm(`Delete (restart) pod ${node.name}?`) &&
              void runAction(() => api.remove('Pod', node.namespace!, node.name), 'deleted')
            }
          >
            Delete / Restart
          </button>
        )}
        {node.kind === 'Service' && node.namespace && (
          <button
            className="action-btn danger"
            disabled={busy}
            onClick={() =>
              confirm(`Delete service ${node.name}?`) &&
              void runAction(() => api.remove('Service', node.namespace!, node.name), 'deleted')
            }
          >
            Delete
          </button>
        )}
        {pod && (
          <>
            <button className="action-btn" onClick={() => openTerminal({ mode: 'logs', ...pod })}>
              Logs
            </button>
            <button className="action-btn" onClick={() => openTerminal({ mode: 'exec', ...pod })}>
              Exec shell
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {error && (
          <div
            className={`mb-3 rounded px-2 py-1 ${
              error.startsWith('✓') ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'
            }`}
          >
            {error}
          </div>
        )}

        {labels.length > 0 && (
          <section className="mb-4">
            <h3 className="section-title">Labels</h3>
            <div className="flex flex-wrap gap-1">
              {labels.map(([k, v]) => (
                <span key={k} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gray-300">
                  {k}={v}
                </span>
              ))}
            </div>
          </section>
        )}

        {detail?.events && detail.events.length > 0 && (
          <section className="mb-4">
            <h3 className="section-title">Events</h3>
            <ul className="space-y-1">
              {detail.events.slice(0, 12).map((e, i) => (
                <li
                  key={i}
                  className={`rounded px-2 py-1 ${
                    e.type === 'Warning' ? 'bg-amber-500/10 text-amber-200' : 'bg-white/5 text-gray-300'
                  }`}
                >
                  <span className="font-medium">{e.reason}</span>
                  {e.count && e.count > 1 ? ` ×${e.count}` : ''} — {e.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="section-title">Manifest</h3>
          {detail ? (
            <pre className="overflow-auto rounded bg-black/40 p-2 text-[11px] leading-snug text-gray-300">
              {JSON.stringify(detail.manifest, null, 2)}
            </pre>
          ) : !error ? (
            <p className="text-gray-500">Loading…</p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
