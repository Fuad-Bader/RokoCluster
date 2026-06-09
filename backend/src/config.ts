/** Centralized, environment-driven configuration. */
export const config = {
  /** HTTP/WS port the API server listens on. */
  port: Number(process.env.PORT ?? 4000),

  /** CORS allow-list for the frontend dev server / packaged app. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /**
   * How the backend obtains its initial Kubernetes connection:
   *  - `upload`    : start with no connection; the user uploads a kubeconfig
   *                  through the UI (default)
   *  - `default`   : load from KUBECONFIG / ~/.kube/config on startup (local dev)
   *  - `in-cluster`: use the mounted service-account token (deployed in a Pod)
   * Regardless of this, a kubeconfig can always be uploaded at runtime to switch.
   */
  kubeAuth: (process.env.KUBE_AUTH ?? 'upload') as 'upload' | 'default' | 'in-cluster',

  /** TTL for cached resource detail/manifest reads, in milliseconds. */
  cacheTtlMs: Number(process.env.CACHE_TTL_MS ?? 5000),

  /** Debounce window for coalescing watch events into graph rebuilds. */
  rebuildDebounceMs: Number(process.env.REBUILD_DEBOUNCE_MS ?? 300),
};

export type AppConfig = typeof config;
