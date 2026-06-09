import { useStore } from '../store/useStore';

const DOT: Record<string, string> = {
  open: 'bg-green-500',
  connecting: 'bg-amber-500',
  closed: 'bg-red-500',
};

/** Top bar: branding, cluster context, kubectl quick-filters, live status. */
export function Header() {
  const status = useStore((s) => s.status);
  const connection = useStore((s) => s.connection);
  const lastError = useStore((s) => s.lastError);
  const toggleKind = useStore((s) => s.toggleKind);
  const filters = useStore((s) => s.filters);
  const setNamespace = useStore((s) => s.setNamespace);
  const setShowConnect = useStore((s) => s.setShowConnect);

  // "kubectl get X" style quick-focus: isolate a single kind in the graph.
  const only = (kind: Parameters<typeof toggleKind>[0]) => {
    const store = useStore.getState();
    // Reset all then enable the requested kind.
    for (const k of store.filters.kinds) store.toggleKind(k);
    store.toggleKind(kind);
  };

  return (
    <header className="flex items-center gap-4 border-b border-white/10 bg-panelAlt px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold tracking-tight text-sky-400">Roko</span>
        <span className="text-sm text-gray-400">Cluster</span>
      </div>

      <div className="hidden items-center gap-1 text-xs md:flex">
        <span className="text-gray-500">quick view:</span>
        {(['Pod', 'Deployment', 'Service', 'Node'] as const).map((k) => (
          <button key={k} className="chip" onClick={() => only(k)}>
            get {k.toLowerCase()}s
          </button>
        ))}
        <button
          className="chip"
          onClick={() => {
            const s = useStore.getState();
            // Re-enable every kind.
            for (const k of ['Namespace', 'Node', 'Deployment', 'Service', 'Pod', 'Container'] as const) {
              if (!s.filters.kinds.has(k)) s.toggleKind(k);
            }
            setNamespace('all');
          }}
        >
          show all
        </button>
      </div>

      <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
        <button
          className="chip flex items-center gap-1.5"
          onClick={() => setShowConnect(true)}
          title={status?.server ?? 'Connect to a cluster'}
        >
          🔌
          {status?.configured ? (
            <span className="text-gray-200">{status.context}</span>
          ) : (
            <span className="text-amber-300">connect cluster</span>
          )}
        </button>
        {filters.namespace !== 'all' && <span>ns: {filters.namespace}</span>}
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${DOT[connection]}`} />
          {connection}
        </span>
        {lastError && (
          <span className="max-w-[200px] truncate text-red-400" title={lastError}>
            ⚠ {lastError}
          </span>
        )}
      </div>
    </header>
  );
}
