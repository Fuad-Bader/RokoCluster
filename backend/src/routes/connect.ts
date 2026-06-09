import { Router } from 'express';
import {
  configureFromString,
  setContext,
  clearClient,
  getStatus,
} from '../k8s/client.js';
import { getStore } from '../k8s/store.js';

export const connectRouter = Router();

const MAX_KUBECONFIG_BYTES = 512 * 1024;

/** Current connection status (configured?, source, context, available contexts). */
connectRouter.get('/connect/status', (_req, res) => {
  res.json(getStatus());
});

/**
 * Upload a kubeconfig and connect. The config lives only in memory for the life
 * of the process — it is never written to disk. Switching clusters re-watches
 * from scratch.
 */
connectRouter.post('/connect/kubeconfig', async (req, res) => {
  try {
    const kubeconfig = req.body?.kubeconfig;
    const context = req.body?.context;
    if (typeof kubeconfig !== 'string' || kubeconfig.trim().length < 10) {
      return res.status(400).json({ error: 'kubeconfig is required' });
    }
    if (Buffer.byteLength(kubeconfig, 'utf8') > MAX_KUBECONFIG_BYTES) {
      return res.status(413).json({ error: 'kubeconfig is too large' });
    }
    configureFromString(kubeconfig, typeof context === 'string' && context ? context : undefined);
    await getStore().restart();
    res.json({ ok: true, ...getStatus() });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message ?? err) });
  }
});

/** Switch the active context within the already-uploaded kubeconfig. */
connectRouter.post('/connect/context', async (req, res) => {
  try {
    const context = req.body?.context;
    if (typeof context !== 'string' || !context) {
      return res.status(400).json({ error: 'context is required' });
    }
    setContext(context);
    await getStore().restart();
    res.json({ ok: true, ...getStatus() });
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message ?? err) });
  }
});

/** Disconnect: drop the in-memory config and clear the graph. */
connectRouter.post('/connect/disconnect', (_req, res) => {
  clearClient();
  getStore().reset();
  res.json({ ok: true, ...getStatus() });
});
