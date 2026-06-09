import { Writable } from 'node:stream';
import type { WebSocket } from 'ws';
import { getClient } from './client.js';

export interface LogParams {
  namespace: string;
  pod: string;
  container?: string;
  follow?: boolean;
  tailLines?: number;
}

/**
 * Stream a container's logs to a browser WebSocket. Honors `follow` so the
 * stream stays open and tails new lines, and `tailLines` to bound the initial
 * backlog. Aborts the upstream request when the client disconnects.
 */
export async function startLogs(ws: WebSocket, params: LogParams): Promise<void> {
  const { log } = getClient();

  const sink = new Writable({
    write(chunk, _enc, cb) {
      if (ws.readyState === ws.OPEN) ws.send(chunk as Buffer);
      cb();
    },
  });

  try {
    const req = await log.log(
      params.namespace,
      params.pod,
      params.container ?? '',
      sink,
      {
        follow: params.follow ?? true,
        tailLines: params.tailLines ?? 200,
        pretty: false,
        timestamps: false,
      },
    );

    const abort = () => {
      try {
        (req as { abort?: () => void })?.abort?.();
      } catch {
        /* ignore */
      }
    };
    ws.on('close', abort);
    ws.on('error', abort);
  } catch (err) {
    if (ws.readyState === ws.OPEN) {
      ws.send(`logs failed: ${String(err)}`);
      ws.close();
    }
  }
}
