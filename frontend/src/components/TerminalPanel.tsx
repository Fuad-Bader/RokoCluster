import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store/useStore';
import { wsUrl } from '../lib/api';

/**
 * Integrated xterm.js terminal bound to a backend WebSocket. In `exec` mode it
 * is interactive (keystrokes stream to the container's stdin); in `logs` mode it
 * is a read-only tail of the container log stream.
 */
export function TerminalPanel() {
  const session = useStore((s) => s.terminal);
  const close = useStore((s) => s.closeTerminal);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!session || !hostRef.current) return;

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#0b0e14', foreground: '#e5e7eb' },
      cursorBlink: session.mode === 'exec',
      disableStdin: session.mode === 'logs',
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    const params: Record<string, string> = {
      namespace: session.namespace,
      pod: session.pod,
    };
    if (session.container) params.container = session.container;
    const path = session.mode === 'exec' ? '/ws/exec' : '/ws/logs';
    if (session.mode === 'exec') params.command = '/bin/sh';

    const banner =
      session.mode === 'exec'
        ? `\x1b[90mexec ${session.namespace}/${session.pod}${
            session.container ? ` [${session.container}]` : ''
          }\x1b[0m\r\n`
        : `\x1b[90mlogs ${session.namespace}/${session.pod}${
            session.container ? ` [${session.container}]` : ''
          }\x1b[0m\r\n`;
    term.write(banner);

    const ws = new WebSocket(wsUrl(path, params));
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') term.write(ev.data);
      else term.write(new Uint8Array(ev.data));
    };
    ws.onclose = () => term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');
    ws.onerror = () => term.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n');

    let dataSub: { dispose: () => void } | undefined;
    if (session.mode === 'exec') {
      dataSub = term.onData((d) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(d);
      });
    }

    const sendResize = () => {
      fit.fit();
      if (session.mode === 'exec' && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    const ro = new ResizeObserver(() => sendResize());
    ro.observe(hostRef.current);
    ws.addEventListener('open', sendResize);

    return () => {
      ro.disconnect();
      dataSub?.dispose();
      ws.close();
      term.dispose();
    };
  }, [session?.mode, session?.namespace, session?.pod, session?.container]);

  if (!session) return null;

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-white/10 bg-[#0b0e14]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-xs text-gray-300">
        <span>
          {session.mode === 'exec' ? '⌨ shell' : '📜 logs'} · {session.namespace}/{session.pod}
          {session.container ? ` [${session.container}]` : ''}
        </span>
        <button className="rounded px-2 py-0.5 hover:bg-white/10" onClick={close}>
          ✕ close
        </button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 p-1" />
    </div>
  );
}
