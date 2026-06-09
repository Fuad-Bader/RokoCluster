import type {
  V1Pod,
  V1Node,
  V1Namespace,
  V1Service,
  V1Deployment,
} from '@kubernetes/client-node';
import type {
  GraphLink,
  GraphModel,
  GraphNode,
  ResourceStatus,
} from '../types.js';

export interface RawCollections {
  namespaces: V1Namespace[];
  nodes: V1Node[];
  deployments: V1Deployment[];
  pods: V1Pod[];
  services: V1Service[];
}

/** Build a stable graph id for a resource. */
export function idFor(kind: string, name: string, namespace?: string): string {
  return namespace ? `${kind}/${namespace}/${name}` : `${kind}/${name}`;
}

function podStatus(pod: V1Pod): ResourceStatus {
  const phase = pod.status?.phase;
  switch (phase) {
    case 'Running':
      return 'running';
    case 'Pending':
      return 'pending';
    case 'Succeeded':
      return 'succeeded';
    case 'Failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

function nodeStatus(node: V1Node): ResourceStatus {
  const ready = node.status?.conditions?.find((c) => c.type === 'Ready');
  return ready?.status === 'True' ? 'ready' : 'notready';
}

/** True if a service's selector matches a pod's labels. */
function selectorMatches(
  selector: Record<string, string> | undefined,
  labels: Record<string, string> | undefined,
): boolean {
  if (!selector || Object.keys(selector).length === 0) return false;
  if (!labels) return false;
  return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

/**
 * Transform raw Kubernetes collections into the visual graph model.
 *
 * Relationships emitted:
 *  - Namespace  contains    {Deployment, Pod, Service}
 *  - Deployment manages      Pod        (via ownerReference -> ReplicaSet -> Deployment name prefix, plus label match fallback)
 *  - Pod        runs-on      Node
 *  - Pod        contains     Container
 *  - Service    targets      Pod        (selector match)
 */
export function buildGraph(raw: RawCollections): GraphModel {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seen = new Set<string>();

  const push = (n: GraphNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  // Namespaces
  for (const ns of raw.namespaces) {
    const name = ns.metadata?.name;
    if (!name) continue;
    push({
      id: idFor('Namespace', name),
      kind: 'Namespace',
      name,
      status: ns.status?.phase === 'Active' ? 'running' : 'pending',
      labels: ns.metadata?.labels ?? {},
    });
  }

  // Cluster nodes
  for (const node of raw.nodes) {
    const name = node.metadata?.name;
    if (!name) continue;
    push({
      id: idFor('Node', name),
      kind: 'Node',
      name,
      status: nodeStatus(node),
      labels: node.metadata?.labels ?? {},
      summary: node.status?.nodeInfo?.kubeletVersion,
    });
  }

  // Deployments
  for (const dep of raw.deployments) {
    const name = dep.metadata?.name;
    const namespace = dep.metadata?.namespace;
    if (!name || !namespace) continue;
    const id = idFor('Deployment', name, namespace);
    const ready = dep.status?.readyReplicas ?? 0;
    const desired = dep.spec?.replicas ?? 0;
    push({
      id,
      kind: 'Deployment',
      name,
      namespace,
      status: ready >= desired && desired > 0 ? 'running' : 'pending',
      labels: dep.metadata?.labels ?? {},
      summary: `${ready}/${desired} ready`,
    });
    links.push({
      source: idFor('Namespace', namespace),
      target: id,
      kind: 'contains',
    });
  }

  // Pods (+ their containers), and pod->node, pod->deployment edges
  for (const pod of raw.pods) {
    const name = pod.metadata?.name;
    const namespace = pod.metadata?.namespace;
    if (!name || !namespace) continue;
    const podId = idFor('Pod', name, namespace);
    push({
      id: podId,
      kind: 'Pod',
      name,
      namespace,
      status: podStatus(pod),
      labels: pod.metadata?.labels ?? {},
      summary: pod.spec?.nodeName ? `on ${pod.spec.nodeName}` : undefined,
    });
    links.push({
      source: idFor('Namespace', namespace),
      target: podId,
      kind: 'contains',
    });

    // Pod runs on Node
    const nodeName = pod.spec?.nodeName;
    if (nodeName && seen.has(idFor('Node', nodeName))) {
      links.push({ source: podId, target: idFor('Node', nodeName), kind: 'runs-on' });
    }

    // Deployment manages Pod — match by owning ReplicaSet name prefix.
    const owner = pod.metadata?.ownerReferences?.[0];
    if (owner?.kind === 'ReplicaSet') {
      // ReplicaSet names are `<deployment>-<hash>`; trim the trailing hash.
      const depName = owner.name.replace(/-[a-z0-9]+$/, '');
      const depId = idFor('Deployment', depName, namespace);
      if (seen.has(depId)) {
        links.push({ source: depId, target: podId, kind: 'manages' });
      }
    }

    // Containers
    for (const c of pod.spec?.containers ?? []) {
      const cId = `${podId}/container/${c.name}`;
      const cStatus = pod.status?.containerStatuses?.find((s) => s.name === c.name);
      const running = cStatus?.ready ? 'running' : podStatus(pod);
      push({
        id: cId,
        kind: 'Container',
        name: c.name,
        namespace,
        status: running,
        labels: {},
        summary: c.image,
      });
      links.push({ source: podId, target: cId, kind: 'contains' });
    }
  }

  // Services
  for (const svc of raw.services) {
    const name = svc.metadata?.name;
    const namespace = svc.metadata?.namespace;
    if (!name || !namespace) continue;
    const svcId = idFor('Service', name, namespace);
    push({
      id: svcId,
      kind: 'Service',
      name,
      namespace,
      status: 'running',
      labels: svc.metadata?.labels ?? {},
      summary: svc.spec?.type,
    });
    links.push({
      source: idFor('Namespace', namespace),
      target: svcId,
      kind: 'contains',
    });

    // Service targets matching pods (same namespace).
    const selector = svc.spec?.selector as Record<string, string> | undefined;
    for (const pod of raw.pods) {
      if (pod.metadata?.namespace !== namespace) continue;
      if (selectorMatches(selector, pod.metadata?.labels)) {
        links.push({
          source: svcId,
          target: idFor('Pod', pod.metadata!.name!, namespace),
          kind: 'targets',
        });
      }
    }
  }

  return { nodes, links };
}
