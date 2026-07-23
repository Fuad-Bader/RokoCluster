import { create } from 'zustand';
import type {
  ClusterEvent,
  ConnectionStatus,
  GraphLink,
  GraphModel,
  GraphNode,
  ResourceKind,
  ResourceStatus,
} from '../types';
import { api, wsUrl } from '../lib/api';

export interface TerminalSession {
  mode: 'exec' | 'logs';
  namespace: string;
  pod: string;
  container?: string;
}

export interface Filters {
  search: string;
  kinds: Set<ResourceKind>;
  namespace: string | 'all';
  status: ResourceStatus | 'all';
}

interface State {
  graph: GraphModel;
  namespaces: string[];
  status: ConnectionStatus | null;
  statusLoaded: boolean;
  showConnect: boolean;
  connection: 'connecting' | 'open' | 'closed';
  lastError: string | null;

  selectedId: string | null;
  inspectedId: string | null;
  hoverId: string | null;
  filters: Filters;
  terminal: TerminalSession | null;

  // actions
  connect: () => void;
  refreshStatus: () => Promise<void>;
  uploadKubeconfig: (kubeconfig: string, context?: string) => Promise<void>;
  switchContext: (context: string) => Promise<void>;
  disconnect: () => Promise<void>;
  setShowConnect: (v: boolean) => void;
  setGraph: (g: GraphModel) => void;
  select: (id: string | null) => void;
  inspect: (id: string | null) => void;
  setHover: (id: string | null) => void;
  setSearch: (q: string) => void;
  toggleKind: (k: ResourceKind) => void;
  setNamespace: (ns: string | 'all') => void;
  setStatus: (s: ResourceStatus | 'all') => void;
  openTerminal: (s: TerminalSession) => void;
  closeTerminal: () => void;
}

const ALL_KINDS: ResourceKind[] = [
  'Namespace',
  'Node',
  'Deployment',
  'Service',
  'Pod',
  'Container',
];

/**
 * Merge a freshly-received graph into the existing one, preserving the identity
 * (and therefore the simulation position/velocity) of nodes that still exist.
 * This is what keeps the layout from "exploding" on every live update.
 */
function mergeGraph(prev: GraphNode[], next: GraphNode[]): GraphNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const existing = byId.get(n.id);
    if (existing) {
      // Update data fields in place; keep x/y/vx/vy from the live object.
      existing.kind = n.kind;
      existing.name = n.name;
      existing.namespace = n.namespace;
      existing.status = n.status;
      existing.labels = n.labels;
      existing.summary = n.summary;
      return existing;
    }
    return n;
  });
}

export const useStore = create<State>((set, get) => ({
  graph: { nodes: [], links: [] },
  namespaces: [],
  status: null,
  statusLoaded: false,
  showConnect: false,
  connection: 'connecting',
  lastError: null,

  selectedId: null,
  inspectedId: null,
  hoverId: null,
  filters: {
    search: '',
    kinds: new Set(ALL_KINDS),
    namespace: 'all',
    status: 'all',
  },
  terminal: null,

  connect: () => {
    // Load connection status; if nothing is configured yet, prompt to connect.
    void get().refreshStatus();

    const open = () => {
      set({ connection: 'connecting' });
      const ws = new WebSocket(wsUrl('/ws/updates'));
      ws.onopen = () => set({ connection: 'open', lastError: null });
      ws.onmessage = (ev) => {
        try {
          const evt: ClusterEvent = JSON.parse(ev.data);
          if (evt.type === 'error') {
            set({ lastError: evt.message ?? 'cluster watch error' });
          } else if (evt.graph) {
            get().setGraph(evt.graph);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        set({ connection: 'closed' });
        setTimeout(open, 2000); // auto-reconnect
      };
      ws.onerror = () => ws.close();
    };
    open();
  },

  refreshStatus: async () => {
    try {
      const status = await api.getStatus();
      set({
        status,
        statusLoaded: true,
        // Auto-open the connect dialog when there is no active connection.
        showConnect: get().showConnect || !status.configured,
      });
    } catch (e) {
      set({ statusLoaded: true, lastError: String(e) });
    }
  },

  uploadKubeconfig: async (kubeconfig, context) => {
    const status = await api.uploadKubeconfig(kubeconfig, context);
    set({ status, statusLoaded: true, showConnect: false, lastError: null });
  },

  switchContext: async (context) => {
    const status = await api.switchContext(context);
    set({ status, lastError: null });
  },

  disconnect: async () => {
    const status = await api.disconnect();
    set({
      status,
      graph: { nodes: [], links: [] },
      namespaces: [],
      selectedId: null,
      inspectedId: null,
      showConnect: true,
    });
  },

  setShowConnect: (showConnect) => set({ showConnect }),

  setGraph: (g) => {
    const merged = mergeGraph(get().graph.nodes, g.nodes);
    const namespaces = [...new Set(merged.filter((n) => n.namespace).map((n) => n.namespace!))].sort();
    // Links arrive as id strings; pass through (force-graph resolves to objects).
    const links: GraphLink[] = g.links.map((l) => ({ ...l }));
    set({ graph: { nodes: merged, links }, namespaces });
  },

  select: (id) => set({ selectedId: id }),
  inspect: (id) => set({ inspectedId: id, selectedId: id }),
  setHover: (id) => set({ hoverId: id }),
  setSearch: (search) => set((s) => ({ filters: { ...s.filters, search } })),
  toggleKind: (k) =>
    set((s) => {
      const kinds = new Set(s.filters.kinds);
      if (kinds.has(k)) kinds.delete(k);
      else kinds.add(k);
      return { filters: { ...s.filters, kinds } };
    }),
  setNamespace: (namespace) => set((s) => ({ filters: { ...s.filters, namespace } })),
  setStatus: (status) => set((s) => ({ filters: { ...s.filters, status } })),
  openTerminal: (terminal) => set({ terminal }),
  closeTerminal: () => set({ terminal: null }),
}));

export { ALL_KINDS };
