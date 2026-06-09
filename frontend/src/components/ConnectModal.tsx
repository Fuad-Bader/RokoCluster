import { useRef, useState } from 'react';
import { useStore } from '../store/useStore';

/**
 * Connection dialog: upload (or paste) a kubeconfig to connect to a cluster.
 * The kubeconfig is sent to the backend and held only in memory there. Opens
 * automatically when no cluster is connected, and on demand from the header.
 */
export function ConnectModal() {
  const status = useStore((s) => s.status);
  const uploadKubeconfig = useStore((s) => s.uploadKubeconfig);
  const switchContext = useStore((s) => s.switchContext);
  const setShowConnect = useStore((s) => s.setShowConnect);

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const connected = status?.configured ?? false;

  const onFile = async (file: File) => {
    const content = await file.text();
    setText(content);
    setFileName(file.name);
    setError(null);
  };

  const submit = async () => {
    if (!text.trim()) {
      setError('Choose a kubeconfig file or paste its contents.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadKubeconfig(text);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onSwitch = async (ctx: string) => {
    setBusy(true);
    setError(null);
    try {
      await switchContext(ctx);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-panelAlt shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-100">Connect to a cluster</h2>
          {connected && (
            <button
              className="rounded px-2 py-0.5 text-sm text-gray-400 hover:bg-white/10"
              onClick={() => setShowConnect(false)}
            >
              ✕
            </button>
          )}
        </header>

        <div className="space-y-4 p-5 text-sm">
          {connected && (
            <div className="rounded bg-green-500/10 px-3 py-2 text-green-300">
              Connected to <span className="font-medium">{status?.context}</span>
              {status?.source ? ` (${status.source})` : ''}
              {status?.server ? ` · ${status.server}` : ''}
            </div>
          )}

          <div>
            <label className="section-title">Kubeconfig file</label>
            <div className="flex items-center gap-2">
              <button
                className="action-btn"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                Choose file…
              </button>
              <span className="truncate text-gray-400">{fileName ?? 'no file selected'}</span>
              <input
                ref={fileRef}
                type="file"
                accept=".yaml,.yml,.conf,.config,text/*,application/yaml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </div>
          </div>

          <div>
            <label className="section-title">…or paste it</label>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
              }}
              placeholder="apiVersion: v1&#10;kind: Config&#10;clusters: …"
              spellCheck={false}
              className="h-40 w-full resize-none rounded bg-black/40 p-2 font-mono text-xs text-gray-100 outline-none ring-1 ring-white/10 focus:ring-sky-500"
            />
          </div>

          {error && <div className="rounded bg-red-500/15 px-3 py-2 text-red-300">{error}</div>}

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Held in memory on the server only — never written to disk.
            </p>
            <button
              className="rounded bg-sky-600 px-4 py-1.5 font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
              onClick={submit}
              disabled={busy}
            >
              {busy ? 'Connecting…' : connected ? 'Replace kubeconfig' : 'Connect'}
            </button>
          </div>

          {connected && (status?.contexts.length ?? 0) > 1 && (
            <div className="border-t border-white/10 pt-4">
              <label className="section-title">Switch context</label>
              <select
                value={status?.context ?? ''}
                onChange={(e) => void onSwitch(e.target.value)}
                disabled={busy}
                className="w-full rounded bg-black/40 px-2 py-1.5 text-gray-100 outline-none ring-1 ring-white/10"
              >
                {status?.contexts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
