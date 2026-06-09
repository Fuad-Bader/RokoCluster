import type { ResourceKind } from '../types.js';

const KINDS: ResourceKind[] = [
  'Namespace',
  'Node',
  'Deployment',
  'Pod',
  'Container',
  'Service',
];

// DNS-1123 subdomain/label — what Kubernetes object names must conform to.
const NAME_RE = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;

export class ValidationError extends Error {}

export function assertKind(value: unknown): ResourceKind {
  if (typeof value !== 'string' || !KINDS.includes(value as ResourceKind)) {
    throw new ValidationError(`invalid kind: ${String(value)}`);
  }
  return value as ResourceKind;
}

/** Validate a Kubernetes object/namespace name to block injection via the API path. */
export function assertName(value: unknown, field = 'name'): string {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new ValidationError(`invalid ${field}: ${String(value)}`);
  }
  return value;
}

export function assertReplicas(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    throw new ValidationError(`invalid replicas: ${String(value)}`);
  }
  return n;
}

/** Container names follow the same label rules; optional. */
export function assertOptionalName(value: unknown, field = 'name'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return assertName(value, field);
}
