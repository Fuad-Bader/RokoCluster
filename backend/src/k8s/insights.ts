import type {
  V1Container,
  V1Deployment,
  V1Namespace,
  V1Node,
  V1Pod,
  V1Service,
} from '@kubernetes/client-node';
import type {
  DeclaredPort,
  NetworkEndpoint,
  ResourceKind,
  ResourceNetwork,
  ResourceOverviewField,
  ResourceRelationship,
  ServiceConnection,
  ServicePortDetail,
} from '../types.js';
import { getClient } from './client.js';
import { idFor } from './graph.js';

interface InsightInput {
  kind: ResourceKind;
  name: string;
  namespace?: string;
  container?: string;
  manifest: unknown;
}

export interface ResourceInsights {
  overview: ResourceOverviewField[];
  relationships: ResourceRelationship[];
  network: ResourceNetwork;
}

function selectorMatches(
  selector: Record<string, string> | undefined,
  labels: Record<string, string> | undefined,
): boolean {
  if (!selector || Object.keys(selector).length === 0 || !labels) return false;
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function addField(
  fields: ResourceOverviewField[],
  label: string,
  value: unknown,
): void {
  if (value === undefined || value === null || value === '') return;
  fields.push({ label, value: String(value) });
}

function commonOverview(manifest: {
  metadata?: { creationTimestamp?: Date; uid?: string };
}): ResourceOverviewField[] {
  const fields: ResourceOverviewField[] = [];
  addField(
    fields,
    'Created',
    manifest.metadata?.creationTimestamp
      ? new Date(manifest.metadata.creationTimestamp).toLocaleString()
      : undefined,
  );
  addField(fields, 'UID', manifest.metadata?.uid);
  return fields;
}

function containerPorts(containers: V1Container[]): DeclaredPort[] {
  return containers.flatMap((container) =>
    (container.ports ?? []).map((port) => ({
      container: container.name,
      name: port.name,
      port: port.containerPort,
      hostPort: port.hostPort,
      protocol: port.protocol ?? 'TCP',
    })),
  );
}

function deploymentForPod(
  pod: V1Pod,
  deployments: V1Deployment[],
): V1Deployment | undefined {
  const owner = pod.metadata?.ownerReferences?.find((ref) => ref.kind === 'ReplicaSet');
  if (owner) {
    const deploymentName = owner.name.replace(/-[a-z0-9]+$/, '');
    const owned = deployments.find((deployment) => deployment.metadata?.name === deploymentName);
    if (owned) return owned;
  }
  return deployments.find((deployment) =>
    selectorMatches(
      deployment.spec?.selector?.matchLabels,
      pod.metadata?.labels,
    ),
  );
}

function relationship(
  kind: ResourceKind,
  name: string,
  relation: string,
  namespace?: string,
): ResourceRelationship {
  return { id: idFor(kind, name, namespace), kind, name, namespace, relation };
}

function uniqueRelationships(
  relationships: ResourceRelationship[],
): ResourceRelationship[] {
  const seen = new Set<string>();
  return relationships.filter((item) => {
    const key = `${item.relation}|${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function servicePorts(service: V1Service): ServicePortDetail[] {
  return (service.spec?.ports ?? []).map((port) => ({
    name: port.name,
    protocol: port.protocol ?? 'TCP',
    port: port.port,
    targetPort: String(port.targetPort ?? port.port),
    nodePort: port.nodePort,
    appProtocol: port.appProtocol,
  }));
}

function nodeAddresses(nodes: V1Node[]): string[] {
  const preferred = nodes.flatMap((node) =>
    (node.status?.addresses ?? [])
      .filter((address) => address.type === 'ExternalIP')
      .map((address) => address.address),
  );
  if (preferred.length > 0) return [...new Set(preferred)];
  return [
    ...new Set(
      nodes.flatMap((node) =>
        (node.status?.addresses ?? [])
          .filter((address) => address.type === 'InternalIP')
          .map((address) => address.address),
      ),
    ),
  ];
}

function serviceEndpoints(service: V1Service, nodes: V1Node[]): NetworkEndpoint[] {
  const namespace = service.metadata?.namespace ?? 'default';
  const name = service.metadata?.name ?? 'service';
  const endpoints: NetworkEndpoint[] = [];
  const clusterIPs =
    service.spec?.clusterIPs ??
    (service.spec?.clusterIP ? [service.spec.clusterIP] : []);
  const externalAddresses = [
    ...(service.spec?.externalIPs ?? []),
    ...(service.status?.loadBalancer?.ingress ?? []).flatMap((item) =>
      [item.ip, item.hostname].filter((value): value is string => Boolean(value)),
    ),
  ];

  for (const port of servicePorts(service)) {
    endpoints.push({
      scope: 'cluster',
      address: `${name}.${namespace}.svc`,
      port: port.port,
      protocol: port.protocol,
      description: 'Cluster DNS',
    });
    for (const clusterIP of clusterIPs.filter((ip) => ip && ip !== 'None')) {
      endpoints.push({
        scope: 'cluster',
        address: clusterIP,
        port: port.port,
        protocol: port.protocol,
        description: 'Cluster IP',
      });
    }
    for (const address of externalAddresses) {
      endpoints.push({
        scope: 'external',
        address,
        port: port.port,
        protocol: port.protocol,
        description: 'External service address',
      });
    }
    if (service.spec?.externalName) {
      endpoints.push({
        scope: 'external',
        address: service.spec.externalName,
        port: port.port,
        protocol: port.protocol,
        description: 'ExternalName',
      });
    }
    if (port.nodePort) {
      for (const address of nodeAddresses(nodes)) {
        endpoints.push({
          scope: 'node',
          address,
          port: port.nodePort,
          protocol: port.protocol,
          description: 'NodePort',
        });
      }
    }
  }
  return endpoints;
}

function serviceConnection(
  service: V1Service,
  pods: V1Pod[],
  nodes: V1Node[],
): ServiceConnection {
  const namespace = service.metadata?.namespace ?? 'default';
  const name = service.metadata?.name ?? 'service';
  const selector = (service.spec?.selector ?? {}) as Record<string, string>;
  const targets = pods
    .filter(
      (pod) =>
        pod.metadata?.namespace === namespace &&
        selectorMatches(selector, pod.metadata?.labels),
    )
    .map((pod) => pod.metadata?.name)
    .filter((podName): podName is string => Boolean(podName));
  const ports = servicePorts(service);
  const forwardPort = ports.find((port) => port.protocol === 'TCP');
  return {
    name,
    namespace,
    type: service.spec?.type ?? 'ClusterIP',
    selector,
    ports,
    endpoints: serviceEndpoints(service, nodes),
    targetPods: targets,
    portForwardCommand: forwardPort
      ? `kubectl -n ${namespace} port-forward svc/${name} ${forwardPort.port}:${forwardPort.port}`
      : undefined,
  };
}

function overviewFor(
  input: InsightInput,
  pod: V1Pod | undefined,
): ResourceOverviewField[] {
  switch (input.kind) {
    case 'Pod': {
      const value = input.manifest as V1Pod;
      const fields = commonOverview(value);
      addField(fields, 'Phase', value.status?.phase);
      addField(fields, 'Node', value.spec?.nodeName);
      addField(fields, 'Pod IP', value.status?.podIP);
      addField(fields, 'Host IP', value.status?.hostIP);
      addField(fields, 'QoS class', value.status?.qosClass);
      addField(fields, 'Service account', value.spec?.serviceAccountName);
      addField(fields, 'Restart policy', value.spec?.restartPolicy);
      return fields;
    }
    case 'Container': {
      const value = input.manifest as V1Container;
      const fields: ResourceOverviewField[] = [];
      addField(fields, 'Pod', pod?.metadata?.name);
      addField(fields, 'Image', value.image);
      addField(fields, 'Image pull policy', value.imagePullPolicy);
      addField(fields, 'Command', value.command?.join(' '));
      addField(fields, 'Arguments', value.args?.join(' '));
      const status = pod?.status?.containerStatuses?.find(
        (item) => item.name === input.container,
      );
      addField(fields, 'Ready', status?.ready);
      addField(fields, 'Restarts', status?.restartCount);
      return fields;
    }
    case 'Deployment': {
      const value = input.manifest as V1Deployment;
      const fields = commonOverview(value);
      addField(fields, 'Desired replicas', value.spec?.replicas ?? 0);
      addField(fields, 'Ready replicas', value.status?.readyReplicas ?? 0);
      addField(fields, 'Available replicas', value.status?.availableReplicas ?? 0);
      addField(fields, 'Updated replicas', value.status?.updatedReplicas ?? 0);
      addField(fields, 'Strategy', value.spec?.strategy?.type);
      return fields;
    }
    case 'Service': {
      const value = input.manifest as V1Service;
      const fields = commonOverview(value);
      addField(fields, 'Type', value.spec?.type ?? 'ClusterIP');
      addField(fields, 'Cluster IP', value.spec?.clusterIP);
      addField(fields, 'External name', value.spec?.externalName);
      addField(fields, 'Session affinity', value.spec?.sessionAffinity);
      addField(fields, 'External traffic policy', value.spec?.externalTrafficPolicy);
      return fields;
    }
    case 'Node': {
      const value = input.manifest as V1Node;
      const fields = commonOverview(value);
      const ready = value.status?.conditions?.find((condition) => condition.type === 'Ready');
      addField(fields, 'Ready', ready?.status);
      addField(fields, 'Kubelet', value.status?.nodeInfo?.kubeletVersion);
      addField(fields, 'OS image', value.status?.nodeInfo?.osImage);
      addField(fields, 'Architecture', value.status?.nodeInfo?.architecture);
      addField(fields, 'Container runtime', value.status?.nodeInfo?.containerRuntimeVersion);
      return fields;
    }
    case 'Namespace': {
      const value = input.manifest as V1Namespace;
      const fields = commonOverview(value);
      addField(fields, 'Phase', value.status?.phase);
      return fields;
    }
  }
}

/**
 * Derive a human-readable description, graph relationships, and network access
 * information for every resource kind supported by the graph.
 */
export async function buildResourceInsights(
  input: InsightInput,
): Promise<ResourceInsights> {
  const { core, apps } = getClient();
  const targetNamespace = input.kind === 'Namespace' ? input.name : input.namespace;

  let pods: V1Pod[] = [];
  let services: V1Service[] = [];
  let deployments: V1Deployment[] = [];

  if (targetNamespace) {
    const [podList, serviceList, deploymentList] = await Promise.all([
      core.listNamespacedPod({ namespace: targetNamespace }),
      core.listNamespacedService({ namespace: targetNamespace }),
      apps.listNamespacedDeployment({ namespace: targetNamespace }),
    ]);
    pods = podList.items ?? [];
    services = serviceList.items ?? [];
    deployments = deploymentList.items ?? [];
  } else if (input.kind === 'Node') {
    const [podList, serviceList] = await Promise.all([
      core.listPodForAllNamespaces(),
      core.listServiceForAllNamespaces(),
    ]);
    pods = podList.items ?? [];
    services = serviceList.items ?? [];
  }

  let nodes: V1Node[] = [];
  try {
    nodes = (await core.listNode()).items ?? [];
  } catch {
    if (input.kind === 'Node') nodes = [input.manifest as V1Node];
  }

  const selectedPod =
    input.kind === 'Pod' || input.kind === 'Container'
      ? pods.find((item) => item.metadata?.name === input.name)
      : undefined;

  let relevantPods: V1Pod[] = [];
  switch (input.kind) {
    case 'Pod':
    case 'Container':
      relevantPods = selectedPod ? [selectedPod] : [];
      break;
    case 'Deployment': {
      const deployment = input.manifest as V1Deployment;
      relevantPods = pods.filter((item) =>
        selectorMatches(deployment.spec?.selector?.matchLabels, item.metadata?.labels),
      );
      break;
    }
    case 'Service': {
      const service = input.manifest as V1Service;
      relevantPods = pods.filter((item) =>
        selectorMatches(
          service.spec?.selector as Record<string, string> | undefined,
          item.metadata?.labels,
        ),
      );
      break;
    }
    case 'Node':
      relevantPods = pods.filter((item) => item.spec?.nodeName === input.name);
      break;
    case 'Namespace':
      relevantPods = pods;
      break;
  }

  let relevantServices: V1Service[] = [];
  switch (input.kind) {
    case 'Service':
      relevantServices = [input.manifest as V1Service];
      break;
    case 'Pod':
    case 'Container':
      relevantServices = selectedPod
        ? services.filter((service) =>
            selectorMatches(
              service.spec?.selector as Record<string, string> | undefined,
              selectedPod.metadata?.labels,
            ),
          )
        : [];
      break;
    case 'Deployment': {
      const deployment = input.manifest as V1Deployment;
      relevantServices = services.filter((service) =>
        selectorMatches(
          service.spec?.selector as Record<string, string> | undefined,
          deployment.spec?.template?.metadata?.labels,
        ),
      );
      break;
    }
    case 'Node':
      relevantServices = services.filter((service) =>
        relevantPods.some((pod) =>
          selectorMatches(
            service.spec?.selector as Record<string, string> | undefined,
            pod.metadata?.labels,
          ),
        ),
      );
      break;
    case 'Namespace':
      relevantServices = services;
      break;
  }

  const relationships: ResourceRelationship[] = [];
  if (input.namespace) {
    relationships.push(
      relationship('Namespace', input.namespace, 'belongs to'),
    );
  }

  if (input.kind === 'Pod' && selectedPod) {
    if (selectedPod.spec?.nodeName) {
      relationships.push(
        relationship('Node', selectedPod.spec.nodeName, 'runs on'),
      );
    }
    const deployment = deploymentForPod(selectedPod, deployments);
    if (deployment?.metadata?.name) {
      relationships.push(
        relationship(
          'Deployment',
          deployment.metadata.name,
          'managed by',
          input.namespace,
        ),
      );
    }
    for (const container of selectedPod.spec?.containers ?? []) {
      relationships.push({
        id: `${idFor('Pod', input.name, input.namespace)}/container/${container.name}`,
        kind: 'Container',
        name: container.name,
        namespace: input.namespace,
        relation: 'contains',
      });
    }
  }

  if (input.kind === 'Container' && selectedPod) {
    relationships.push(
      relationship('Pod', input.name, 'contained by', input.namespace),
    );
  }

  if (input.kind === 'Deployment') {
    for (const pod of relevantPods) {
      if (pod.metadata?.name) {
        relationships.push(
          relationship('Pod', pod.metadata.name, 'manages', pod.metadata.namespace),
        );
      }
    }
  }

  if (input.kind === 'Service') {
    for (const pod of relevantPods) {
      if (pod.metadata?.name) {
        relationships.push(
          relationship('Pod', pod.metadata.name, 'targets', pod.metadata.namespace),
        );
      }
    }
  }

  if (input.kind === 'Node') {
    for (const pod of relevantPods) {
      if (pod.metadata?.name) {
        relationships.push(
          relationship('Pod', pod.metadata.name, 'hosts', pod.metadata.namespace),
        );
      }
    }
  }

  if (input.kind === 'Namespace') {
    for (const deployment of deployments) {
      if (deployment.metadata?.name) {
        relationships.push(
          relationship(
            'Deployment',
            deployment.metadata.name,
            'contains',
            input.name,
          ),
        );
      }
    }
    for (const service of services) {
      if (service.metadata?.name) {
        relationships.push(
          relationship('Service', service.metadata.name, 'contains', input.name),
        );
      }
    }
    for (const pod of pods) {
      if (pod.metadata?.name) {
        relationships.push(
          relationship('Pod', pod.metadata.name, 'contains', input.name),
        );
      }
    }
  }

  for (const service of relevantServices) {
    if (
      ['Pod', 'Container', 'Deployment', 'Node'].includes(input.kind) &&
      service.metadata?.name
    ) {
      relationships.push(
        relationship(
          'Service',
          service.metadata.name,
          'exposed by',
          service.metadata.namespace,
        ),
      );
    }
  }

  let declaredPorts: DeclaredPort[] = [];
  switch (input.kind) {
    case 'Pod':
      declaredPorts = containerPorts((input.manifest as V1Pod).spec?.containers ?? []);
      break;
    case 'Container':
      declaredPorts = containerPorts([input.manifest as V1Container]);
      break;
    case 'Deployment':
      declaredPorts = containerPorts(
        (input.manifest as V1Deployment).spec?.template?.spec?.containers ?? [],
      );
      break;
    case 'Node':
    case 'Namespace':
      declaredPorts = containerPorts(
        relevantPods.flatMap((item) => item.spec?.containers ?? []),
      );
      break;
    case 'Service':
      declaredPorts = containerPorts(
        relevantPods.flatMap((item) => item.spec?.containers ?? []),
      );
      break;
  }

  const podIPs = relevantPods
    .flatMap((item) => item.status?.podIPs?.map((entry) => entry.ip) ?? [item.status?.podIP])
    .filter((value): value is string => Boolean(value));
  const hostIPs = relevantPods
    .map((item) => item.status?.hostIP)
    .filter((value): value is string => Boolean(value));
  const forwardPort = declaredPorts.find((port) => port.protocol === 'TCP');
  let directPortForwardCommand: string | undefined;
  if (forwardPort && input.namespace) {
    if (input.kind === 'Pod' || input.kind === 'Container') {
      directPortForwardCommand =
        `kubectl -n ${input.namespace} port-forward pod/${input.name} ` +
        `${forwardPort.port}:${forwardPort.port}`;
    } else if (input.kind === 'Deployment') {
      directPortForwardCommand =
        `kubectl -n ${input.namespace} port-forward deployment/${input.name} ` +
        `${forwardPort.port}:${forwardPort.port}`;
    }
  }

  return {
    overview: overviewFor(input, selectedPod),
    relationships: uniqueRelationships(relationships),
    network: {
      podIPs: [...new Set(podIPs)],
      hostIPs: [...new Set(hostIPs)],
      declaredPorts,
      services: relevantServices.map((service) =>
        serviceConnection(service, pods, nodes),
      ),
      directPortForwardCommand,
    },
  };
}
