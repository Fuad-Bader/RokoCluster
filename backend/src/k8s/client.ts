import * as k8s from '@kubernetes/client-node';

/**
 * How the active Kubernetes connection was established.
 *  - default    : loaded from the local kubeconfig (KUBECONFIG / ~/.kube/config)
 *  - in-cluster : the mounted service-account token (deployed in a Pod)
 *  - uploaded   : a kubeconfig the user uploaded through the UI at runtime
 */
export type ConfigSource = 'default' | 'in-cluster' | 'uploaded';

interface Clients {
  kc: k8s.KubeConfig;
  core: k8s.CoreV1Api;
  apps: k8s.AppsV1Api;
  exec: k8s.Exec;
  log: k8s.Log;
  watch: k8s.Watch;
  source: ConfigSource;
}

export interface ConnectionStatus {
  configured: boolean;
  source: ConfigSource | null;
  context: string | null;
  cluster: string | null;
  server: string | null;
  contexts: string[];
}

// The single active connection. Null until a kubeconfig is provided (either on
// startup, depending on KUBE_AUTH, or via an upload at runtime).
let current: Clients | null = null;

function build(kc: k8s.KubeConfig, source: ConfigSource): Clients {
  return {
    kc,
    core: kc.makeApiClient(k8s.CoreV1Api),
    apps: kc.makeApiClient(k8s.AppsV1Api),
    exec: new k8s.Exec(kc),
    log: new k8s.Log(kc),
    watch: new k8s.Watch(kc),
    source,
  };
}

/** Configure from an uploaded kubeconfig YAML string. */
export function configureFromString(kubeconfig: string, context?: string): void {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  if (context) kc.setCurrentContext(context);
  if (!kc.getCurrentContext() || !kc.getCurrentCluster()) {
    throw new Error('kubeconfig has no usable current context/cluster');
  }
  current = build(kc, 'uploaded');
}

/** Configure from the local kubeconfig (dev / desktop). */
export function configureDefault(): void {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  current = build(kc, 'default');
}

/** Configure from the in-cluster service account (deployed). */
export function configureInCluster(): void {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  current = build(kc, 'in-cluster');
}

/** Switch the active context within the already-loaded kubeconfig. */
export function setContext(context: string): void {
  if (!current) throw new Error('not configured');
  const names = current.kc.getContexts().map((c) => c.name);
  if (!names.includes(context)) throw new Error(`unknown context: ${context}`);
  current.kc.setCurrentContext(context);
  // Rebuild the API clients so they bind to the new context.
  current = build(current.kc, current.source);
}

export function clearClient(): void {
  current = null;
}

export function isConfigured(): boolean {
  return current !== null;
}

export function getClient(): Clients {
  if (!current) {
    throw new Error('Kubernetes connection not configured — upload a kubeconfig first.');
  }
  return current;
}

export function getStatus(): ConnectionStatus {
  if (!current) {
    return { configured: false, source: null, context: null, cluster: null, server: null, contexts: [] };
  }
  const kc = current.kc;
  const cluster = kc.getCurrentCluster();
  return {
    configured: true,
    source: current.source,
    context: kc.getCurrentContext(),
    cluster: cluster?.name ?? null,
    server: cluster?.server ?? null,
    contexts: kc.getContexts().map((c) => c.name),
  };
}
