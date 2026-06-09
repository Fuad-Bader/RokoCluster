import { EventEmitter } from 'node:events';
import type {
  KubernetesObject,
  V1Pod,
  V1Node,
  V1Namespace,
  V1Service,
  V1Deployment,
} from '@kubernetes/client-node';
import { getClient } from './client.js';
import { buildGraph, type RawCollections } from './graph.js';
import type { GraphModel } from '../types.js';
import { config } from '../config.js';

type Watchable = KubernetesObject & { metadata?: { uid?: string; name?: string } };

interface WatchSpec {
  key: keyof RawCollections;
  path: string;
}

const WATCHES: WatchSpec[] = [
  { key: 'namespaces', path: '/api/v1/namespaces' },
  { key: 'nodes', path: '/api/v1/nodes' },
  { key: 'pods', path: '/api/v1/pods' },
  { key: 'services', path: '/api/v1/services' },
  { key: 'deployments', path: '/apis/apps/v1/deployments' },
];

/**
 * Maintains an in-memory mirror of the cluster's core resources by consuming
 * the Kubernetes watch API, and emits a debounced `changed` event carrying a
 * freshly-built graph. Acts as both the cache for the graph and the source of
 * truth pushed to clients over WebSocket.
 */
export class ClusterStore extends EventEmitter {
  private collections: Record<keyof RawCollections, Map<string, Watchable>> = {
    namespaces: new Map(),
    nodes: new Map(),
    pods: new Map(),
    services: new Map(),
    deployments: new Map(),
  };

  private aborts: Array<{ abort: () => void }> = [];
  private rebuildTimer: NodeJS.Timeout | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const spec of WATCHES) {
      void this.startWatch(spec);
    }
  }

  stop(): void {
    for (const a of this.aborts) {
      try {
        a.abort();
      } catch {
        /* ignore */
      }
    }
    this.aborts = [];
    this.started = false;
  }

  private clearCollections(): void {
    for (const key of Object.keys(this.collections) as (keyof RawCollections)[]) {
      this.collections[key].clear();
    }
  }

  /** Stop current watches, discard cached state, and re-watch the (new) cluster. */
  async restart(): Promise<void> {
    this.stop();
    this.clearCollections();
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.emit('changed', this.getGraph()); // push an empty graph so the UI resets
    await this.start();
  }

  /** Tear down watches and clear the graph (e.g. on disconnect). */
  reset(): void {
    this.stop();
    this.clearCollections();
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    this.emit('changed', this.getGraph());
  }

  getGraph(): GraphModel {
    const raw: RawCollections = {
      namespaces: [...this.collections.namespaces.values()] as V1Namespace[],
      nodes: [...this.collections.nodes.values()] as V1Node[],
      pods: [...this.collections.pods.values()] as V1Pod[],
      services: [...this.collections.services.values()] as V1Service[],
      deployments: [...this.collections.deployments.values()] as V1Deployment[],
    };
    return buildGraph(raw);
  }

  private keyOf(obj: Watchable): string {
    return obj.metadata?.uid ?? `${obj.metadata?.name}`;
  }

  private apply(key: keyof RawCollections, type: string, obj: Watchable): void {
    const map = this.collections[key];
    const id = this.keyOf(obj);
    if (type === 'DELETED') {
      map.delete(id);
    } else {
      map.set(id, obj);
    }
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.emit('changed', this.getGraph());
    }, config.rebuildDebounceMs);
  }

  private async startWatch(spec: WatchSpec): Promise<void> {
    const { watch } = getClient();
    try {
      const req = await watch.watch(
        spec.path,
        {},
        (type: string, apiObj: Watchable) => this.apply(spec.key, type, apiObj),
        (err?: unknown) => {
          // The stream ended (timeout, network, or error). Re-establish it.
          if (err) {
            this.emit('watch-error', { path: spec.path, error: String(err) });
          }
          if (this.started) {
            setTimeout(() => void this.startWatch(spec), 1000);
          }
        },
      );
      // v1.x returns an object with abort(); guard for older shapes.
      if (req && typeof (req as { abort?: unknown }).abort === 'function') {
        this.aborts.push(req as { abort: () => void });
      }
    } catch (err) {
      this.emit('watch-error', { path: spec.path, error: String(err) });
      if (this.started) setTimeout(() => void this.startWatch(spec), 2000);
    }
  }
}

let storeSingleton: ClusterStore | null = null;

export function getStore(): ClusterStore {
  if (!storeSingleton) storeSingleton = new ClusterStore();
  return storeSingleton;
}
