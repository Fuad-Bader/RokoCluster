/**
 * Domain model shared across the backend. The graph model mirrors what the
 * frontend's force-graph consumes, so the transformation layer can emit it
 * directly without an extra mapping step on the client.
 */

export type ResourceKind =
  | 'Namespace'
  | 'Node'
  | 'Deployment'
  | 'Pod'
  | 'Container'
  | 'Service';

export type ResourceStatus =
  | 'running'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'ready'
  | 'notready';

export interface GraphNode {
  /** Stable, globally-unique id: `${kind}/${namespace}/${name}` (namespace omitted for cluster-scoped). */
  id: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  status: ResourceStatus;
  /** Free-form labels, copied from the resource metadata. */
  labels: Record<string, string>;
  /** A compact, display-friendly summary line (e.g. "3/3 ready"). */
  summary?: string;
}

export type GraphLinkKind =
  | 'runs-on' // pod -> node
  | 'contains' // pod -> container, namespace -> resource
  | 'manages' // deployment -> pod
  | 'targets' // service -> pod
  | 'belongs-to'; // resource -> namespace

export interface GraphLink {
  source: string;
  target: string;
  kind: GraphLinkKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** A normalized event pushed over the updates WebSocket. */
export interface ClusterEvent {
  type: 'snapshot' | 'update' | 'error';
  /** Full graph for `snapshot`; partial/diagnostic payloads otherwise. */
  graph?: GraphModel;
  message?: string;
  ts: number;
}

/** Raw resource detail returned by the REST detail endpoint. */
export interface ResourceDetail {
  id: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  manifest: unknown;
  events: KubeEventSummary[];
}

export interface KubeEventSummary {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
}
