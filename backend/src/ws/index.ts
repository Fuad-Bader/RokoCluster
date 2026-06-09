import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { getStore } from '../k8s/store.js';
import { startExec } from '../k8s/exec.js';
import { startLogs } from '../k8s/logs.js';
import { assertName, assertOptionalName, ValidationError } from '../routes/validate.js';
import type { ClusterEvent } from '../types.js';

/**
 * Attach WebSocket endpoints to the HTTP server, routed by pathname:
 *   /ws/updates  — live graph snapshots (broadcast on every change)
 *   /ws/exec     — interactive container shell (bridged to xterm.js)
 *   /ws/logs     — streaming container logs
 */
export function attachWebSockets(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const store = getStore();

  // Fan-out graph changes to all connected /ws/updates clients.
  const updateClients = new Set<WebSocket>();
  store.on('changed', (graph) => {
    const evt: ClusterEvent = { type: 'update', graph, ts: Date.now() };
    const payload = JSON.stringify(evt);
    for (const ws of updateClients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  });
  store.on('watch-error', (info) => {
    const evt: ClusterEvent = { type: 'error', message: JSON.stringify(info), ts: Date.now() };
    const payload = JSON.stringify(evt);
    for (const ws of updateClients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url ?? '', 'http://localhost');

    if (pathname === '/ws/updates') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        updateClients.add(ws);
        // Send an immediate snapshot so a fresh client renders without waiting.
        const snapshot: ClusterEvent = { type: 'snapshot', graph: store.getGraph(), ts: Date.now() };
        ws.send(JSON.stringify(snapshot));
        ws.on('close', () => updateClients.delete(ws));
        ws.on('error', () => updateClients.delete(ws));
      });
      return;
    }

    if (pathname === '/ws/exec') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          const namespace = assertName(searchParams.get('namespace'), 'namespace');
          const pod = assertName(searchParams.get('pod'), 'pod');
          const container = assertOptionalName(searchParams.get('container'), 'container');
          const shell = searchParams.get('command') || '/bin/sh';
          // Allow a small, fixed set of shells only.
          const command = ['/bin/bash', '/bin/sh', 'sh', 'bash'].includes(shell)
            ? [shell]
            : ['/bin/sh'];
          void startExec(ws, { namespace, pod, container, command });
        } catch (err) {
          closeWithError(ws, err);
        }
      });
      return;
    }

    if (pathname === '/ws/logs') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
          const namespace = assertName(searchParams.get('namespace'), 'namespace');
          const pod = assertName(searchParams.get('pod'), 'pod');
          const container = assertOptionalName(searchParams.get('container'), 'container');
          const tailLines = Number(searchParams.get('tail') ?? 200);
          void startLogs(ws, { namespace, pod, container, follow: true, tailLines });
        } catch (err) {
          closeWithError(ws, err);
        }
      });
      return;
    }

    socket.destroy();
  });
}

function closeWithError(ws: WebSocket, err: unknown): void {
  const msg = err instanceof ValidationError ? err.message : String(err);
  if (ws.readyState === ws.OPEN) {
    ws.send(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
    ws.close();
  }
}
