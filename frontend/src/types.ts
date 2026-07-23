// Mirrors the backend graph model (backend/src/types.ts). Kept as a standalone
// copy so the frontend has no build-time dependency on the backend package.

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
  id: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  status: ResourceStatus;
  labels: Record<string, string>;
  summary?: string;
  // Mutable simulation coordinates injected by react-force-graph / d3-force.
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

export type GraphLinkKind = 'runs-on' | 'contains' | 'manages' | 'targets' | 'belongs-to';

export interface GraphLink {
  // Either ids (as sent by the backend) or resolved node objects (after d3 binds them).
  source: string | GraphNode;
  target: string | GraphNode;
  kind: GraphLinkKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface ClusterEvent {
  type: 'snapshot' | 'update' | 'error';
  graph?: GraphModel;
  message?: string;
  ts: number;
}

export interface KubeEventSummary {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
}

export interface ResourceDetail {
  id: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  overview: ResourceOverviewField[];
  relationships: ResourceRelationship[];
  network: ResourceNetwork;
  manifest: unknown;
  events: KubeEventSummary[];
}

export interface ResourceOverviewField {
  label: string;
  value: string;
}

export interface ResourceRelationship {
  id: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  relation: string;
}

export interface DeclaredPort {
  container: string;
  name?: string;
  port: number;
  hostPort?: number;
  protocol: string;
}

export interface ServicePortDetail {
  name?: string;
  protocol: string;
  port: number;
  targetPort: string;
  nodePort?: number;
  appProtocol?: string;
}

export interface NetworkEndpoint {
  scope: 'pod' | 'cluster' | 'node' | 'external' | 'host';
  address: string;
  port: number;
  protocol: string;
  description: string;
}

export interface ServiceConnection {
  name: string;
  namespace: string;
  type: string;
  selector: Record<string, string>;
  ports: ServicePortDetail[];
  endpoints: NetworkEndpoint[];
  targetPods: string[];
  portForwardCommand?: string;
}

export interface ResourceNetwork {
  podIPs: string[];
  hostIPs: string[];
  declaredPorts: DeclaredPort[];
  services: ServiceConnection[];
  directPortForwardCommand?: string;
}

export type ConfigSource = 'default' | 'in-cluster' | 'uploaded';

export interface ConnectionStatus {
  configured: boolean;
  source: ConfigSource | null;
  context: string | null;
  cluster: string | null;
  server: string | null;
  contexts: string[];
}
