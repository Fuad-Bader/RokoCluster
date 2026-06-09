import { Router } from 'express';
import { getClient } from '../k8s/client.js';
import { assertKind, assertName, assertReplicas, ValidationError } from './validate.js';

export const actionsRouter = Router();

/** Scale a Deployment by reading + replacing its replica count. */
actionsRouter.post('/actions/scale', async (req, res) => {
  try {
    const name = assertName(req.body?.name);
    const namespace = assertName(req.body?.namespace, 'namespace');
    const replicas = assertReplicas(req.body?.replicas);
    const { apps } = getClient();
    const dep = await apps.readNamespacedDeployment({ name, namespace });
    if (!dep.spec) throw new ValidationError('deployment has no spec');
    dep.spec.replicas = replicas;
    await apps.replaceNamespacedDeployment({ name, namespace, body: dep });
    res.json({ ok: true, name, namespace, replicas });
  } catch (err) {
    fail(res, err);
  }
});

/** Rollout-restart a Deployment by stamping the restartedAt annotation. */
actionsRouter.post('/actions/restart', async (req, res) => {
  try {
    const name = assertName(req.body?.name);
    const namespace = assertName(req.body?.namespace, 'namespace');
    const { apps } = getClient();
    const dep = await apps.readNamespacedDeployment({ name, namespace });
    if (!dep.spec) throw new ValidationError('deployment has no spec');
    dep.spec.template.metadata = dep.spec.template.metadata ?? {};
    dep.spec.template.metadata.annotations = {
      ...(dep.spec.template.metadata.annotations ?? {}),
      'roko.cluster/restartedAt': new Date().toISOString(),
    };
    await apps.replaceNamespacedDeployment({ name, namespace, body: dep });
    res.json({ ok: true, name, namespace });
  } catch (err) {
    fail(res, err);
  }
});

/** Delete a Pod, Service or Deployment. Deleting a managed Pod restarts it. */
actionsRouter.post('/actions/delete', async (req, res) => {
  try {
    const kind = assertKind(req.body?.kind);
    const name = assertName(req.body?.name);
    const namespace = assertName(req.body?.namespace, 'namespace');
    const { core, apps } = getClient();
    switch (kind) {
      case 'Pod':
        await core.deleteNamespacedPod({ name, namespace });
        break;
      case 'Service':
        await core.deleteNamespacedService({ name, namespace });
        break;
      case 'Deployment':
        await apps.deleteNamespacedDeployment({ name, namespace });
        break;
      default:
        throw new ValidationError(`cannot delete kind: ${kind}`);
    }
    res.json({ ok: true, kind, name, namespace });
  } catch (err) {
    fail(res, err);
  }
});

function fail(res: import('express').Response, err: unknown): void {
  const status = err instanceof ValidationError ? 400 : 500;
  res.status(status).json({ error: String((err as Error)?.message ?? err) });
}
