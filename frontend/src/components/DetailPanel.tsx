import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { api } from '../lib/api';
import { detailParamsFor, podTargetFor } from '../lib/resource';
import { KIND_STYLE, STATUS_RING } from '../lib/palette';
import type {
  GraphNode,
  NetworkEndpoint,
  ResourceDetail,
  ServiceConnection,
} from '../types';

function StatusDot({ node }: { node: GraphNode }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: STATUS_RING[node.status] }}
      title={node.status}
    />
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      className="rounded px-1.5 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/10"
      onClick={() => void copy()}
      title="Copy to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function EndpointRow({ endpoint }: { endpoint: NetworkEndpoint }) {
  const value = `${endpoint.address}:${endpoint.port}`;
  const color =
    endpoint.scope === 'external' || endpoint.scope === 'node'
      ? 'text-green-300'
      : endpoint.scope === 'cluster'
        ? 'text-sky-300'
        : 'text-gray-300';

  return (
    <div className="flex items-center gap-2 rounded bg-black/25 px-2 py-1">
      <span className="w-16 shrink-0 text-[9px] uppercase tracking-wide text-gray-500">
        {endpoint.scope}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-mono text-[11px] ${color}`}>{value}</div>
        <div className="text-[10px] text-gray-500">
          {endpoint.description} · {endpoint.protocol}
        </div>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceConnection }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.025] p-2.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-gray-100">{service.name}</div>
          <div className="text-[10px] text-gray-500">
            {service.namespace} · {service.targetPods.length} target pod
            {service.targetPods.length === 1 ? '' : 's'}
          </div>
        </div>
        <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] text-fuchsia-300">
          {service.type}
        </span>
      </div>

      {service.ports.length > 0 && (
        <div className="mb-2 overflow-hidden rounded border border-white/5">
          <div className="grid grid-cols-[1fr_1fr_1fr] bg-black/25 px-2 py-1 text-[9px] uppercase tracking-wide text-gray-500">
            <span>Service</span>
            <span>Target</span>
            <span>Node</span>
          </div>
          {service.ports.map((port, index) => (
            <div
              key={`${port.name ?? 'port'}-${port.port}-${index}`}
              className="grid grid-cols-[1fr_1fr_1fr] border-t border-white/5 px-2 py-1 font-mono text-[11px] text-gray-300"
            >
              <span title={port.name}>{port.port}/{port.protocol}</span>
              <span>{port.targetPort}</span>
              <span>{port.nodePort ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {service.endpoints.length > 0 ? (
        <div className="space-y-1">
          {service.endpoints.map((endpoint, index) => (
            <EndpointRow
              key={`${endpoint.scope}-${endpoint.address}-${endpoint.port}-${index}`}
              endpoint={endpoint}
            />
          ))}
        </div>
      ) : (
        <p className="rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          No routable endpoint is currently assigned.
        </p>
      )}

      {service.portForwardCommand && (
        <div className="mt-2 rounded bg-black/35 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-gray-500">
              Access from this computer
            </span>
            <CopyButton value={service.portForwardCommand} />
          </div>
          <code className="block whitespace-pre-wrap break-all text-[10px] text-emerald-300">
            {service.portForwardCommand}
          </code>
        </div>
      )}
    </div>
  );
}

export function DetailPanel() {
  const inspectedId = useStore((state) => state.inspectedId);
  const graph = useStore((state) => state.graph);
  const inspect = useStore((state) => state.inspect);
  const select = useStore((state) => state.select);
  const openTerminal = useStore((state) => state.openTerminal);

  const node = graph.nodes.find((item) => item.id === inspectedId) ?? null;
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
      .then((value) => !cancelled && setDetail(value))
      .catch((reason) => !cancelled && setError(String(reason.message ?? reason)));
    return () => {
      cancelled = true;
    };
  }, [node?.id]);

  useEffect(() => {
    if (!node) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') inspect(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [inspect, node]);

  if (!node) {
    return null;
  }

  const pod = podTargetFor(node);
  const labels = Object.entries(node.labels);
  const network = detail?.network;
  const hasNetwork =
    Boolean(network?.podIPs.length) ||
    Boolean(network?.hostIPs.length) ||
    Boolean(network?.declaredPorts.length) ||
    Boolean(network?.services.length);

  async function runAction(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setError(`OK: ${ok}`);
    } catch (reason) {
      setError(String((reason as Error).message ?? reason));
    } finally {
      setBusy(false);
    }
  }

  const inspectRelated = (id: string) => {
    if (!graph.nodes.some((item) => item.id === id)) return;
    select(id);
    inspect(id);
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-inspector-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) inspect(null);
      }}
    >
    <aside className="absolute inset-y-0 right-0 flex w-[480px] max-w-[92vw] flex-col border-l border-white/10 bg-panel shadow-2xl shadow-black/70">
      <header className="border-b border-white/10 p-4">
        <div className="flex items-start gap-2">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded text-sm"
            style={{
              backgroundColor: `${KIND_STYLE[node.kind].color}33`,
              color: KIND_STYLE[node.kind].color,
            }}
          >
            {KIND_STYLE[node.kind].icon}
          </span>
          <div className="min-w-0 flex-1">
            <div
              id="resource-inspector-title"
              className="truncate font-semibold text-gray-100"
            >
              {node.name}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <StatusDot node={node} /> {node.kind}
              {node.namespace ? ` · ${node.namespace}` : ''}
            </div>
          </div>
          <button
            className="rounded px-2 py-1 text-gray-500 hover:bg-white/5 hover:text-gray-200"
            onClick={() => inspect(null)}
            title="Close inspector"
          >
            ×
          </button>
        </div>
        {node.summary && <p className="mt-2 text-xs text-gray-400">{node.summary}</p>}
      </header>

      <div className="flex flex-wrap gap-2 border-b border-white/10 p-3">
        {node.kind === 'Deployment' && node.namespace && (
          <>
            <button
              className="action-btn"
              disabled={busy}
              onClick={() => {
                const value = prompt(`Scale ${node.name} to how many replicas?`);
                if (value != null) {
                  void runAction(
                    () => api.scale(node.namespace!, node.name, Number(value)),
                    'scaled',
                  );
                }
              }}
            >
              Scale
            </button>
            <button
              className="action-btn"
              disabled={busy}
              onClick={() =>
                void runAction(
                  () => api.restart(node.namespace!, node.name),
                  'restart triggered',
                )
              }
            >
              Restart
            </button>
            <button
              className="action-btn danger"
              disabled={busy}
              onClick={() =>
                confirm(`Delete deployment ${node.name}?`) &&
                void runAction(
                  () => api.remove('Deployment', node.namespace!, node.name),
                  'deleted',
                )
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
              void runAction(
                () => api.remove('Pod', node.namespace!, node.name),
                'deleted',
              )
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
              void runAction(
                () => api.remove('Service', node.namespace!, node.name),
                'deleted',
              )
            }
          >
            Delete
          </button>
        )}
        {pod && (
          <>
            <button
              className="action-btn"
              onClick={() => openTerminal({ mode: 'logs', ...pod })}
            >
              Logs
            </button>
            <button
              className="action-btn"
              onClick={() => openTerminal({ mode: 'exec', ...pod })}
            >
              Exec shell
            </button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {error && (
          <div
            className={`mb-3 rounded px-2 py-1 ${
              error.startsWith('OK:')
                ? 'bg-green-500/15 text-green-300'
                : 'bg-red-500/15 text-red-300'
            }`}
          >
            {error}
          </div>
        )}

        <section className="mb-4">
          <h3 className="section-title">Description</h3>
          {detail ? (
            detail.overview.length > 0 ? (
              <dl className="overflow-hidden rounded border border-white/10 bg-white/[0.025]">
                {detail.overview.map((field) => (
                  <div
                    key={field.label}
                    className="grid grid-cols-[120px_1fr] border-b border-white/5 px-2.5 py-1.5 last:border-b-0"
                  >
                    <dt className="text-gray-500">{field.label}</dt>
                    <dd className="break-all text-gray-200">{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-gray-500">No summary fields are available.</p>
            )
          ) : !error ? (
            <p className="text-gray-500">Loading…</p>
          ) : null}
        </section>

        {detail && (
          <section className="mb-4">
            <h3 className="section-title">Network & access</h3>
            {hasNetwork ? (
              <div className="space-y-2.5">
                {(network?.podIPs.length || network?.hostIPs.length) && (
                  <div className="grid grid-cols-2 gap-2">
                    {network.podIPs.length > 0 && (
                      <div className="rounded bg-white/5 p-2">
                        <div className="text-[9px] uppercase tracking-wide text-gray-500">
                          Pod IP
                        </div>
                        <div className="mt-0.5 break-all font-mono text-[11px] text-sky-300">
                          {network.podIPs.join(', ')}
                        </div>
                      </div>
                    )}
                    {network.hostIPs.length > 0 && (
                      <div className="rounded bg-white/5 p-2">
                        <div className="text-[9px] uppercase tracking-wide text-gray-500">
                          Host IP
                        </div>
                        <div className="mt-0.5 break-all font-mono text-[11px] text-gray-300">
                          {network.hostIPs.join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {network?.declaredPorts.length ? (
                  <div className="rounded border border-white/10 p-2">
                    <div className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">
                      Declared container ports
                    </div>
                    <div className="space-y-1">
                      {network.declaredPorts.map((port, index) => (
                        <div
                          key={`${port.container}-${port.port}-${index}`}
                          className="flex items-center justify-between rounded bg-black/20 px-2 py-1"
                        >
                          <span className="truncate text-gray-400">{port.container}</span>
                          <span className="font-mono text-gray-200">
                            {port.port}/{port.protocol}
                            {port.hostPort ? ` → host:${port.hostPort}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {network?.services.map((service) => (
                  <ServiceCard
                    key={`${service.namespace}/${service.name}`}
                    service={service}
                  />
                ))}

                {network?.services.length === 0 && (
                  <div className="rounded bg-amber-500/10 px-2.5 py-2 text-amber-200">
                    No Service selector currently exposes this entity.
                  </div>
                )}

                {network?.directPortForwardCommand && (
                  <div className="rounded bg-black/35 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[9px] uppercase tracking-wide text-gray-500">
                        Direct access from this computer
                      </span>
                      <CopyButton value={network.directPortForwardCommand} />
                    </div>
                    <code className="block whitespace-pre-wrap break-all text-[10px] text-emerald-300">
                      {network.directPortForwardCommand}
                    </code>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded bg-white/5 px-2.5 py-2 text-gray-400">
                No declared ports or connected Services were found for this entity.
              </div>
            )}
          </section>
        )}

        {detail?.relationships.length ? (
          <section className="mb-4">
            <h3 className="section-title">Relationships</h3>
            <div className="space-y-1">
              {detail.relationships.map((item) => {
                const available = graph.nodes.some((nodeItem) => nodeItem.id === item.id);
                return (
                  <button
                    key={`${item.relation}-${item.id}`}
                    className="flex w-full items-center gap-2 rounded bg-white/5 px-2 py-1.5 text-left hover:bg-white/10 disabled:cursor-default"
                    onClick={() => inspectRelated(item.id)}
                    disabled={!available}
                    title={available ? `Inspect ${item.kind}` : undefined}
                  >
                    <span className="w-20 shrink-0 text-[10px] uppercase text-gray-500">
                      {item.relation}
                    </span>
                    <span style={{ color: KIND_STYLE[item.kind].color }}>
                      {KIND_STYLE[item.kind].icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-gray-200">
                      {item.name}
                    </span>
                    <span className="text-[10px] text-gray-500">{item.kind}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {labels.length > 0 && (
          <section className="mb-4">
            <h3 className="section-title">Labels</h3>
            <div className="flex flex-wrap gap-1">
              {labels.map(([key, value]) => (
                <span
                  key={key}
                  className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-gray-300"
                >
                  {key}={value}
                </span>
              ))}
            </div>
          </section>
        )}

        {detail?.events.length ? (
          <section className="mb-4">
            <h3 className="section-title">Events</h3>
            <ul className="space-y-1">
              {detail.events.slice(0, 12).map((event, index) => (
                <li
                  key={index}
                  className={`rounded px-2 py-1 ${
                    event.type === 'Warning'
                      ? 'bg-amber-500/10 text-amber-200'
                      : 'bg-white/5 text-gray-300'
                  }`}
                >
                  <span className="font-medium">{event.reason}</span>
                  {event.count && event.count > 1 ? ` ×${event.count}` : ''} —{' '}
                  {event.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {detail && (
          <details>
            <summary className="section-title cursor-pointer select-none">
              Full manifest
            </summary>
            <pre className="mt-1 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-snug text-gray-300">
              {JSON.stringify(detail.manifest, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </aside>
    </div>
  );
}
