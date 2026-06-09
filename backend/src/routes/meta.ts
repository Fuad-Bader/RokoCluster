import { Router } from 'express';
import { getStatus } from '../k8s/client.js';
import { getStore } from '../k8s/store.js';

export const metaRouter = Router();

metaRouter.get('/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

metaRouter.get('/context', (_req, res) => {
  // Never throws when unconfigured — returns { configured: false }.
  res.json(getStatus());
});

/** Current full graph snapshot (also pushed live over the updates WebSocket). */
metaRouter.get('/graph', (_req, res) => {
  res.json(getStore().getGraph());
});
