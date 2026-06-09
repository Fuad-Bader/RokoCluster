import { useStore, ALL_KINDS } from '../store/useStore';
import { applyFilters } from '../lib/filter';
import { KIND_STYLE, STATUS_RING } from '../lib/palette';
import type { ResourceStatus } from '../types';

const STATUSES: (ResourceStatus | 'all')[] = [
  'all',
  'running',
  'pending',
  'failed',
  'ready',
  'notready',
];

/** Left rail: search, type/namespace/status filters and a color legend. */
export function Sidebar() {
  const filters = useStore((s) => s.filters);
  const namespaces = useStore((s) => s.namespaces);
  const graph = useStore((s) => s.graph);
  const setSearch = useStore((s) => s.setSearch);
  const toggleKind = useStore((s) => s.toggleKind);
  const setNamespace = useStore((s) => s.setNamespace);
  const setStatus = useStore((s) => s.setStatus);

  const visible = applyFilters(graph, filters).nodes.length;

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-auto border-r border-white/10 bg-panel p-3 text-sm">
      <div>
        <label className="section-title">Search</label>
        <input
          value={filters.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="name, type, or label…"
          className="w-full rounded bg-black/40 px-2 py-1.5 text-gray-100 outline-none ring-1 ring-white/10 focus:ring-sky-500"
        />
      </div>

      <div>
        <label className="section-title">Resource types</label>
        <div className="flex flex-col gap-1">
          {ALL_KINDS.map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={filters.kinds.has(k)}
                onChange={() => toggleKind(k)}
              />
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: KIND_STYLE[k].color }}
              />
              <span className="text-gray-200">{k}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="section-title">Namespace</label>
        <select
          value={filters.namespace}
          onChange={(e) => setNamespace(e.target.value)}
          className="w-full rounded bg-black/40 px-2 py-1.5 text-gray-100 outline-none ring-1 ring-white/10"
        >
          <option value="all">all namespaces</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="section-title">Status</label>
        <select
          value={filters.status}
          onChange={(e) => setStatus(e.target.value as ResourceStatus | 'all')}
          className="w-full rounded bg-black/40 px-2 py-1.5 text-gray-100 outline-none ring-1 ring-white/10"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-auto">
        <label className="section-title">Legend</label>
        <div className="space-y-1 text-xs text-gray-400">
          {ALL_KINDS.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span style={{ color: KIND_STYLE[k].color }}>{KIND_STYLE[k].icon}</span>
              {k}
            </div>
          ))}
          <div className="mt-2 border-t border-white/10 pt-2">status ring</div>
          <div className="flex flex-wrap gap-2">
            {(['running', 'pending', 'failed', 'notready'] as ResourceStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_RING[s] }}
                />
                {s}
              </span>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">{visible} resources shown</p>
      </div>
    </aside>
  );
}
