import { Router } from 'express';
import { getClient } from '../k8s/client.js';
import { TtlCache } from '../cache.js';
import { config } from '../config.js';
import { assertKind, assertName, assertOptionalName, ValidationError } from './validate.js';
import type { KubeEventSummary, ResourceDetail } from '../types.js';
import { buildResourceInsights } from '../k8s/insights.js';

const cache = new TtlCache<ResourceDetail>(config.cacheTtlMs);

/**
 * Fetch the full manifest for a resource. Cluster-scoped kinds (Node,
 * Namespace) ignore namespace; Container resolves to its parent Pod's spec.
 */
async function readManifest(
  kind: string,
  name: string,
  namespace?: string,
  container?: string,
): Promise<unknown> {
  const { core, apps } = getClient();
  switch (kind) {
    case 'Pod':
      return core.readNamespacedPod({ name, namespace: namespace! });
    case 'Container': {
      const pod = await core.readNamespacedPod({ name, namespace: namespace! });
      const c = pod.spec?.containers?.find((x) => x.name === container);
      return c ?? { error: `container ${container} not found in pod ${name}` };
    }
    case 'Deployment':
      return apps.readNamespacedDeployment({ name, namespace: namespace! });
    case 'Service':
      return core.readNamespacedService({ name, namespace: namespace! });
    case 'Node':
      return core.readNode({ name });
    case 'Namespace':
      return core.readNamespace({ name });
    default:
      throw new ValidationError(`unsupported kind: ${kind}`);
  }
}

async function readEvents(name: string, namespace?: string): Promise<KubeEventSummary[]> {
  if (!namespace) return [];
  const { core } = getClient();
  try {
    const res = await core.listNamespacedEvent({
      namespace,
      fieldSelector: `involvedObject.name=${name}`,
    });
    return (res.items ?? []).map((e) => ({
      type: e.type,
      reason: e.reason,
      message: e.message,
      count: e.count,
      lastTimestamp: e.lastTimestamp ? new Date(e.lastTimestamp).toISOString() : undefined,
    }));
  } catch {
    return [];
  }
}

export const detailRouter = Router();

detailRouter.get('/resource', async (req, res) => {
  try {
    const kind = assertKind(req.query.kind);
    const name = assertName(req.query.name);
    const namespace =
      kind === 'Node' || kind === 'Namespace'
        ? undefined
        : assertName(req.query.namespace, 'namespace');
    // For Container the `name` is the pod, and `container` names the child.
    const container = assertOptionalName(req.query.container, 'container');

    const cacheKey = `${kind}|${namespace ?? ''}|${name}|${container ?? ''}`;
    const detail = await cache.wrap(cacheKey, async () => {
      const manifest = await readManifest(kind, name, namespace, container);
      const events = await readEvents(name, namespace);
      const insights = await buildResourceInsights({
        kind,
        name,
        namespace,
        container,
        manifest,
      });
      return {
        id: cacheKey,
        kind,
        name,
        namespace,
        ...insights,
        manifest,
        events,
      } satisfies ResourceDetail;
    });
    res.json(detail);
  } catch (err) {
    const status = err instanceof ValidationError ? 400 : 500;
    res.status(status).json({ error: String((err as Error).message ?? err) });
  }
});
