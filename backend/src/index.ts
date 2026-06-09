import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { metaRouter } from './routes/meta.js';
import { detailRouter } from './routes/detail.js';
import { actionsRouter } from './routes/actions.js';
import { connectRouter } from './routes/connect.js';
import { attachWebSockets } from './ws/index.js';
import { getStore } from './k8s/store.js';
import { configureDefault, configureInCluster } from './k8s/client.js';

async function main(): Promise<void> {
  const app = express();
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', metaRouter);
  app.use('/api', connectRouter);
  app.use('/api', detailRouter);
  app.use('/api', actionsRouter);

  // Serve the built frontend in production (single-container deploy).
  const staticDir = process.env.STATIC_DIR;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => res.sendFile(`${staticDir}/index.html`));
  }

  const server = http.createServer(app);
  attachWebSockets(server);

  // Establish the initial connection per KUBE_AUTH. In `upload` mode we start
  // with no connection and wait for the user to upload a kubeconfig via the UI.
  // Failures here never crash the HTTP server — the UI surfaces them and the
  // user can (re)connect at runtime.
  try {
    if (config.kubeAuth === 'in-cluster') {
      configureInCluster();
      await getStore().start();
    } else if (config.kubeAuth === 'default') {
      configureDefault();
      await getStore().start();
    } else {
      console.log('[roko] upload mode — waiting for a kubeconfig from the UI');
    }
  } catch (err) {
    console.error('[roko] initial connection failed; upload a kubeconfig from the UI:', err);
  }

  server.listen(config.port, () => {
    console.log(`[roko] backend listening on http://localhost:${config.port}`);
    console.log(`[roko] kube auth mode: ${config.kubeAuth}`);
  });

  const shutdown = () => {
    console.log('[roko] shutting down…');
    getStore().stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
