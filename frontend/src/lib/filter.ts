import type { Filters } from '../store/useStore';
import type { GraphLink, GraphModel, GraphNode } from '../types';

const CLUSTER_SCOPED = new Set(['Node', 'Namespace']);

/** Does a node satisfy the active kind/namespace/status filters? */
export function passesFilter(n: GraphNode, f: Filters): boolean {
  if (!f.kinds.has(n.kind)) return false;
  if (f.status !== 'all' && n.status !== f.status) return false;
  if (f.namespace !== 'all' && !CLUSTER_SCOPED.has(n.kind) && n.namespace !== f.namespace) {
    return false;
  }
  return true;
}

/** Does a node match the free-text search (name, kind, or any label)? */
export function matchesSearch(n: GraphNode, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  if (n.name.toLowerCase().includes(q)) return true;
  if (n.kind.toLowerCase().includes(q)) return true;
  if (n.namespace?.toLowerCase().includes(q)) return true;
  return Object.entries(n.labels).some(
    ([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q),
  );
}

function endpointId(e: string | GraphNode): string {
  return typeof e === 'string' ? e : e.id;
}

/** Produce the visible subgraph given the current filters. */
export function applyFilters(graph: GraphModel, f: Filters): GraphModel {
  const visible = new Set<string>();
  const nodes = graph.nodes.filter((n) => {
    const ok = passesFilter(n, f);
    if (ok) visible.add(n.id);
    return ok;
  });
  const links = graph.links.filter(
    (l: GraphLink) => visible.has(endpointId(l.source)) && visible.has(endpointId(l.target)),
  );
  return { nodes, links };
}

/** Set of node ids directly connected to `id` (for hover highlighting). */
export function neighborsOf(graph: GraphModel, id: string): Set<string> {
  const set = new Set<string>([id]);
  for (const l of graph.links) {
    const s = endpointId(l.source);
    const t = endpointId(l.target);
    if (s === id) set.add(t);
    if (t === id) set.add(s);
  }
  return set;
}
