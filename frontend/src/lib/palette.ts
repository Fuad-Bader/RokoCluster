import type { ResourceKind, ResourceStatus } from '../types';

/** Per-kind visual identity: color, single-glyph icon and relative node size. */
export const KIND_STYLE: Record<ResourceKind, { color: string; icon: string; size: number }> = {
  Namespace: { color: '#8b5cf6', icon: '▢', size: 9 },
  Node: { color: '#0ea5e9', icon: '⬢', size: 8 },
  Deployment: { color: '#22c55e', icon: '◆', size: 7 },
  Pod: { color: '#f59e0b', icon: '●', size: 5 },
  Container: { color: '#eab308', icon: '▪', size: 3 },
  Service: { color: '#ec4899', icon: '◇', size: 6 },
};

/** Status ring color overlaid on the node to signal health at a glance. */
export const STATUS_RING: Record<ResourceStatus, string> = {
  running: '#22c55e',
  ready: '#22c55e',
  succeeded: '#3b82f6',
  pending: '#eab308',
  notready: '#f97316',
  failed: '#ef4444',
  unknown: '#6b7280',
};

export const KIND_ORDER: ResourceKind[] = [
  'Namespace',
  'Node',
  'Deployment',
  'Service',
  'Pod',
  'Container',
];
