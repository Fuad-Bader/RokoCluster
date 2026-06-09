import type { GraphNode, ResourceKind } from '../types';

export interface DetailParams {
  kind: ResourceKind;
  name: string;
  namespace?: string;
  container?: string;
}

/** Parameters needed to address a node over the detail REST API. */
export function detailParamsFor(node: GraphNode): DetailParams {
  if (node.kind === 'Container') {
    // Container id: `Pod/<ns>/<pod>/container/<name>`
    const [, ns, pod] = node.id.split('/');
    return { kind: 'Container', name: pod, namespace: ns, container: node.name };
  }
  return { kind: node.kind, name: node.name, namespace: node.namespace };
}

/** The owning pod + container for exec/logs, if this node addresses a workload. */
export function podTargetFor(
  node: GraphNode,
): { namespace: string; pod: string; container?: string } | null {
  if (node.kind === 'Pod' && node.namespace) {
    return { namespace: node.namespace, pod: node.name };
  }
  if (node.kind === 'Container') {
    const [, ns, pod] = node.id.split('/');
    return { namespace: ns, pod, container: node.name };
  }
  return null;
}
