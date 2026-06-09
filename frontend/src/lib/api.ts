import type { ConnectionStatus, GraphModel, ResourceDetail, ResourceKind } from '../types';

// Same-origin: Vite proxies /api and /ws to the backend in dev; in production
// the backend serves the built assets, so relative URLs work unchanged.
async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getStatus: () => json<ConnectionStatus>('/api/connect/status'),
  getGraph: () => json<GraphModel>('/api/graph'),

  uploadKubeconfig: (kubeconfig: string, context?: string) =>
    json<ConnectionStatus & { ok: boolean }>('/api/connect/kubeconfig', {
      method: 'POST',
      body: JSON.stringify({ kubeconfig, context }),
    }),

  switchContext: (context: string) =>
    json<ConnectionStatus & { ok: boolean }>('/api/connect/context', {
      method: 'POST',
      body: JSON.stringify({ context }),
    }),

  disconnect: () =>
    json<ConnectionStatus & { ok: boolean }>('/api/connect/disconnect', { method: 'POST' }),

  getDetail: (params: {
    kind: ResourceKind;
    name: string;
    namespace?: string;
    container?: string;
  }) => {
    const qs = new URLSearchParams();
    qs.set('kind', params.kind);
    qs.set('name', params.name);
    if (params.namespace) qs.set('namespace', params.namespace);
    if (params.container) qs.set('container', params.container);
    return json<ResourceDetail>(`/api/resource?${qs.toString()}`);
  },

  scale: (namespace: string, name: string, replicas: number) =>
    json('/api/actions/scale', {
      method: 'POST',
      body: JSON.stringify({ namespace, name, replicas }),
    }),

  restart: (namespace: string, name: string) =>
    json('/api/actions/restart', {
      method: 'POST',
      body: JSON.stringify({ namespace, name }),
    }),

  remove: (kind: ResourceKind, namespace: string, name: string) =>
    json('/api/actions/delete', {
      method: 'POST',
      body: JSON.stringify({ kind, namespace, name }),
    }),
};

/** Resolve a ws:// or wss:// URL for a given path against the current origin. */
export function wsUrl(path: string, params: Record<string, string> = {}): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const qs = new URLSearchParams(params).toString();
  return `${proto}://${location.host}${path}${qs ? `?${qs}` : ''}`;
}
