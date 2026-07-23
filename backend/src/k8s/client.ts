import * as k8s from '@kubernetes/client-node';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

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

function mapMinikubeFile(file: string | undefined): string | undefined {
  if (!file || !config.minikubeMountPath) return file;
  const normalized = file.replaceAll('\\', '/');
  const marker = '/.minikube/';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  if (markerIndex < 0) return file;

  const relative = normalized.slice(markerIndex + marker.length);
  const parts = relative.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '..')) return file;
  return path.join(config.minikubeMountPath, ...parts);
}

function adaptUploadedConfig(kc: k8s.KubeConfig): void {
  kc.clusters = kc.clusters.map((cluster) => {
    let server = cluster.server;
    let tlsServerName = cluster.tlsServerName;
    if (config.kubeLoopbackHost) {
      try {
        const url = new URL(server);
        const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(
          url.hostname,
        );
        if (loopback) {
          url.hostname = config.kubeLoopbackHost;
          server = url.toString().replace(/\/$/, '');
          tlsServerName =
            tlsServerName ??
            config.kubeLoopbackTlsServerName ??
            (url.hostname === 'localhost' ? 'localhost' : undefined);
        }
      } catch {
        // KubeConfig validation will surface a malformed server URL.
      }
    }
    return {
      ...cluster,
      server,
      tlsServerName,
      caFile: mapMinikubeFile(cluster.caFile),
    };
  });

  kc.users = kc.users.map((user) => ({
    ...user,
    certFile: mapMinikubeFile(user.certFile),
    keyFile: mapMinikubeFile(user.keyFile),
  }));
}

function assertReferencedFilesExist(kc: k8s.KubeConfig): void {
  const cluster = kc.getCurrentCluster();
  const user = kc.getCurrentUser();
  const referenced = [
    !cluster?.caData ? cluster?.caFile : undefined,
    !user?.certData ? user?.certFile : undefined,
    !user?.keyData ? user?.keyFile : undefined,
  ].filter((file): file is string => Boolean(file));
  const missing = referenced.filter((file) => !fs.existsSync(file));
  if (missing.length === 0) return;

  throw new Error(
    'The kubeconfig references credential files that are not available to Roko: ' +
      `${missing.join(', ')}. For Docker, mount the referenced credential directory ` +
      'or import a flattened config generated with ' +
      '`kubectl config view --raw --flatten --minify`.',
  );
}

/** Configure and verify an uploaded kubeconfig YAML/JSON string. */
export async function configureFromString(
  kubeconfig: string,
  context?: string,
): Promise<void> {
  const kc = new k8s.KubeConfig();
  kc.loadFromString(kubeconfig);
  if (context) kc.setCurrentContext(context);
  if (!kc.getCurrentContext() || !kc.getCurrentCluster()) {
    throw new Error('kubeconfig has no usable current context/cluster');
  }
  adaptUploadedConfig(kc);
  assertReferencedFilesExist(kc);

  // Do not report "connected" until credentials, TLS, and routing have all
  // succeeded against the cluster API.
  const candidate = build(kc, 'uploaded');
  await candidate.core.listNamespace({ limit: 1 });
  current = candidate;
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
