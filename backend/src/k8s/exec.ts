import { PassThrough, Writable } from 'node:stream';
import type { WebSocket } from 'ws';
import { getClient } from './client.js';

export interface ExecParams {
  namespace: string;
  pod: string;
  container?: string;
  command: string[];
}

/**
 * Bridge a browser WebSocket (driving an xterm.js terminal) to an interactive
 * `exec` session inside a container. Terminal keystrokes flow in as text/binary
 * messages and are written to the container's stdin; container stdout/stderr are
 * streamed back as binary frames.
 *
 * Control messages: a JSON frame `{"type":"resize","cols":N,"rows":M}` is
 * interpreted as a TTY resize rather than stdin.
 */
export async function startExec(ws: WebSocket, params: ExecParams): Promise<void> {
  const { exec } = getClient();
  const stdin = new PassThrough();

  const toClient = (chunk: Buffer | string) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  };
  const stdout = new Writable({
    write(chunk, _enc, cb) {
      toClient(chunk as Buffer);
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      toClient(chunk as Buffer);
      cb();
    },
  });

  ws.on('message', (raw: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      const text = raw.toString();
      // Try to interpret as a control frame; fall back to raw stdin.
      if (text.startsWith('{') && text.includes('"type"')) {
        try {
          const msg = JSON.parse(text);
          if (msg.type === 'resize' && execHandle?.resize) {
            execHandle.resize({ width: msg.cols, height: msg.rows });
            return;
          }
        } catch {
          /* not a control frame — treat as stdin */
        }
      }
      stdin.write(text);
      return;
    }
    stdin.write(raw);
  });

  let execHandle: { resize?: (size: { width: number; height: number }) => void } | undefined;

  try {
    const conn = await exec.exec(
      params.namespace,
      params.pod,
      params.container ?? '',
      params.command,
      stdout,
      stderr,
      stdin,
      true, // tty
      (status) => {
        toClient(`\r\n\x1b[90m[process exited: ${status?.status ?? 'unknown'}]\x1b[0m\r\n`);
        if (ws.readyState === ws.OPEN) ws.close();
      },
    );
    // The kubernetes client returns the underlying websocket; expose resize if available.
    execHandle = conn as unknown as typeof execHandle;
  } catch (err) {
    toClient(`\r\n\x1b[31mexec failed: ${String(err)}\x1b[0m\r\n`);
    if (ws.readyState === ws.OPEN) ws.close();
  }

  ws.on('close', () => {
    stdin.end();
  });
}
